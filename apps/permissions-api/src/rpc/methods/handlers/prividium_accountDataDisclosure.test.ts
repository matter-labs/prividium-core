import { type Hex, keccak256, numberToHex, pad, size } from 'viem';
import { describe, expect } from 'vitest';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import type { TestExternalRpc } from '../../../../test/rpc/test-external-rpc';
import { ForbiddenRpcError, WrongArguments } from '../../errors';
import type { ZksGetProofResponse } from '../../target-rpc';
import { prividium_accountDataDisclosure } from './prividium_accountDataDisclosure';

const method = prividium_accountDataDisclosure;
const address: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const blockNumber: Hex = '0x1a';
const requestId = 'req1';

const ACCOUNT_PROPERTIES_ADDRESS: Hex = '0x0000000000000000000000000000000000008003';

const fakeBatchNumber = 42;
const fakeBalance: Hex = '0xde0b6b3a7640000'; // 1 ETH
const fakeNonce = 7n;

const fakeProof: ZksGetProofResponse = {
    address: ACCOUNT_PROPERTIES_ADDRESS,
    stateCommitmentPreimage: {
        nextFreeSlot: '0x01',
        blockNumber,
        last256BlockHashesBlake: '0xabcd',
        lastBlockTimestamp: '0x0f'
    },
    storageProofs: [
        {
            key: pad(address),
            proof: { type: 'existing', index: 0, value: '0x01', nextIndex: 1, siblings: [] }
        }
    ],
    l1VerificationData: {
        batchNumber: fakeBatchNumber,
        numberOfLayer1Txs: 0,
        priorityOperationsHash: '0x00',
        dependencyRootsRollingHash: '0x00',
        l2ToL1LogsRootHash: '0x00',
        commitment: '0x00'
    }
};

function setupEoa(rpc: TestExternalRpc, blockHex: Hex = blockNumber) {
    rpc.registerBatchForBlock(`${requestId}_batchNumber`, fakeBatchNumber);
    rpc.registerBalanceFor(address, fakeBalance);
    rpc.registerCodeFor(address, '0x');
    rpc.setNonceFor(address, fakeNonce);
    rpc.registerGetProf(`${requestId}_proof`, fakeProof);
    if (blockHex !== blockNumber) {
        rpc.registerResolveBlockNumber(`${requestId}_batchNumber_resolve`, blockHex);
    }
}

describe('rpc method: prividium_accountDataDisclosure', () => {
    rpcUnitTest('rejects when bytecode disclosure is not enabled', async ({ reqContext, authorizer, rpc }) => {
        setupEoa(rpc);
        rpc.registerCodeFor(address, '0x6001'); // contract code so bytecode-disclosure check is meaningful
        authorizer.setBytecodeDisclosureConfig(null);

        await expect(
            method.handle(reqContext, 'prividium_accountDataDisclosure', [address, blockNumber], requestId)
        ).rejects.toThrow(ForbiddenRpcError);
    });

    rpcUnitTest('resolves a block tag and uses the resolved hex downstream', async ({ reqContext, rpc }) => {
        const resolvedHex: Hex = '0x2b';
        setupEoa(rpc, resolvedHex);

        await method.handle(reqContext, 'prividium_accountDataDisclosure', [address, 'latest'], requestId);

        expect(rpc.batchForBlockRegistry[0]).toEqual({
            id: `${requestId}_batchNumber`,
            block: 'latest',
            blockNumber: resolvedHex
        });
    });

    rpcUnitTest('passes hex blockNumber through unchanged', async ({ reqContext, rpc }) => {
        setupEoa(rpc);

        await method.handle(reqContext, 'prividium_accountDataDisclosure', [address, blockNumber], requestId);

        expect(rpc.batchForBlockRegistry[0]).toEqual({
            id: `${requestId}_batchNumber`,
            block: blockNumber,
            blockNumber
        });
    });

    rpcUnitTest(
        'propagates WrongArguments when batchForBlock rejects an unbatched block',
        async ({ reqContext, rpc }) => {
            setupEoa(rpc);
            rpc.registerBatchForBlockError(
                `${requestId}_batchNumber`,
                new WrongArguments(`Block ${blockNumber} has not been included in a batch yet`)
            );

            await expect(
                method.handle(reqContext, 'prividium_accountDataDisclosure', [address, blockNumber], requestId)
            ).rejects.toThrow(WrongArguments);
        }
    );

    rpcUnitTest(
        'rejects when the requested block is before disclosureStartBlock',
        async ({ reqContext, rpc, authorizer }) => {
            setupEoa(rpc);
            // 0x1a = 26; raise the floor to 0x64 (100)
            authorizer.setBytecodeDisclosureConfig({ disclosureStartBlock: '0x64' });

            await expect(
                method.handle(reqContext, 'prividium_accountDataDisclosure', [address, blockNumber], requestId)
            ).rejects.toThrow(/is before disclosure start block 0x64/);
        }
    );

    rpcUnitTest('returns the correct response shape for an EOA', async ({ reqContext, rpc }) => {
        setupEoa(rpc);

        const res = await method.handle(
            reqContext,
            'prividium_accountDataDisclosure',
            [address, blockNumber],
            requestId
        );

        expect(res).toEqual({
            jsonrpc: '2.0',
            id: requestId,
            result: {
                accountProperties: {
                    versioningData: numberToHex(0n),
                    nonce: numberToHex(fakeNonce),
                    balance: fakeBalance,
                    bytecodeHash: pad('0x'),
                    unpaddedCodeLen: size('0x'),
                    artifactsLen: 0,
                    observableBytecodeHash: pad('0x'),
                    observableBytecodeLen: size('0x')
                },
                address,
                bytecode: '0x',
                batchNumber: fakeBatchNumber,
                l1VerificationData: fakeProof.l1VerificationData,
                stateCommitmentPreimage: fakeProof.stateCommitmentPreimage,
                storageProof: fakeProof.storageProofs[0]!.proof
            }
        });
    });

    rpcUnitTest('marks the account as a contract when code is non-empty', async ({ reqContext, rpc }) => {
        setupEoa(rpc);
        const code: Hex = '0x6001';
        rpc.registerCodeFor(address, code);

        const res = (await method.handle(
            reqContext,
            'prividium_accountDataDisclosure',
            [address, blockNumber],
            requestId
        )) as Extract<Awaited<ReturnType<typeof method.handle>>, { result: unknown }>;

        const result = res.result as {
            bytecode: Hex;
            accountProperties: { observableBytecodeHash: Hex; observableBytecodeLen: number };
        };
        expect(result.bytecode).toBe(code);
        expect(result.accountProperties.observableBytecodeHash).toBe(keccak256(code));
        expect(result.accountProperties.observableBytecodeLen).toBe(size(code));
    });

    rpcUnitTest('returns same id that was provided', async ({ reqContext, rpc }) => {
        setupEoa(rpc);

        const res = await method.handle(
            reqContext,
            'prividium_accountDataDisclosure',
            [address, blockNumber],
            requestId
        );

        expect(res).toHaveProperty('id', requestId);
    });
});
