import { encodeFunctionData, type Hex, numberToHex, pad, parseAbiItem, zeroAddress } from 'viem';
import { describe, expect } from 'vitest';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import type { TestExternalRpc } from '../../../../test/rpc/test-external-rpc';
import { ForbiddenRpcError, WrongArguments } from '../../errors';
import type { ZksGetProofResponse } from '../../target-rpc';
import { prividium_tokenSupplyDisclosure } from './prividium_tokenSupplyDisclosure';

const method = prividium_tokenSupplyDisclosure;
const tokenAddress: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const blockNumber: Hex = '0x1a';
const requestId = 'req1';

const totalSupplyAbi = [parseAbiItem('function totalSupply() public view returns (uint256)')];
const expectedCallData = encodeFunctionData({ abi: totalSupplyAbi, functionName: 'totalSupply' });

const contractA: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const slotRawA1 = '0000000000000000000000000000000000000000000000000000000000000001';
const slotRawA2 = '0000000000000000000000000000000000000000000000000000000000000005';

const fakeBatchNumber = 42;

const fakeProofA: ZksGetProofResponse = {
    address: contractA,
    stateCommitmentPreimage: {
        nextFreeSlot: '0x01',
        blockNumber: '0x1a',
        last256BlockHashesBlake: '0xabcd',
        lastBlockTimestamp: '0x0f'
    },
    storageProofs: [
        {
            key: pad(numberToHex(BigInt(`0x${slotRawA1}`))),
            proof: { type: 'existing', index: 0, value: '0x01', nextIndex: 1, siblings: [] }
        },
        {
            key: pad(numberToHex(BigInt(`0x${slotRawA2}`))),
            proof: { type: 'existing', index: 1, value: '0x02', nextIndex: 2, siblings: [] }
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

function setup(rpc: TestExternalRpc) {
    rpc.registerDebugCall(`${requestId}_traceCall`, {
        success: true,
        value: '0x64', // 100 in hex
        reads: {
            [contractA]: [slotRawA1, slotRawA2]
        },
        addresses: [contractA]
    });
    rpc.registerBatchForBlock(`${requestId}_batchNumber`, fakeBatchNumber);
    rpc.registerGetProf(`${requestId}_proof_${contractA}`, fakeProofA);
}

describe('rpc method: prividium_tokenSupplyDisclosure', () => {
    rpcUnitTest('rejects when supply disclosure is not enabled', async ({ reqContext, authorizer }) => {
        authorizer.setSupplyDisclosureConfig(null);

        await expect(
            method.handle(reqContext, 'prividium_tokenSupplyDisclosure', [tokenAddress, blockNumber], requestId)
        ).rejects.toThrow(ForbiddenRpcError);
    });

    rpcUnitTest('debugCall is called with the correct arguments', async ({ reqContext, rpc }) => {
        setup(rpc);

        await method.handle(reqContext, 'prividium_tokenSupplyDisclosure', [tokenAddress, blockNumber], requestId);

        expect(rpc.debugCallRegistry).toHaveLength(1);
        expect(rpc.debugCallRegistry[0]).toEqual({
            id: `${requestId}_traceCall`,
            from: zeroAddress,
            to: tokenAddress,
            callData: expectedCallData,
            blockNumber
        });
    });

    rpcUnitTest('batchForBlock is called with the correct block number', async ({ reqContext, rpc }) => {
        setup(rpc);

        await method.handle(reqContext, 'prividium_tokenSupplyDisclosure', [tokenAddress, blockNumber], requestId);

        expect(rpc.batchForBlockRegistry).toHaveLength(1);
        expect(rpc.batchForBlockRegistry[0]).toEqual({
            id: `${requestId}_batchNumber`,
            block: blockNumber,
            blockNumber
        });
    });

    rpcUnitTest('getProf is called once per contract returned by debugCall', async ({ reqContext, rpc }) => {
        setup(rpc);

        await method.handle(reqContext, 'prividium_tokenSupplyDisclosure', [tokenAddress, blockNumber], requestId);

        expect(rpc.getProfRegistry).toHaveLength(1);
        expect(rpc.getProfRegistry[0]).toEqual({
            id: `${requestId}_proof_${contractA}`,
            address: contractA,
            slotList: [pad(numberToHex(BigInt(`0x${slotRawA1}`))), pad(numberToHex(BigInt(`0x${slotRawA2}`)))],
            batchNumber: fakeBatchNumber
        });
    });

    rpcUnitTest('returns the correct response shape', async ({ reqContext, rpc }) => {
        setup(rpc);

        const res = await method.handle(
            reqContext,
            'prividium_tokenSupplyDisclosure',
            [tokenAddress, blockNumber],
            requestId
        );

        expect(res).toEqual({
            jsonrpc: '2.0',
            id: requestId,
            result: {
                result: numberToHex(BigInt('0x64')),
                callData: expectedCallData,
                from: zeroAddress,
                to: tokenAddress,
                requiredBytecodes: [contractA],
                batchNumber: fakeBatchNumber,
                stateCommitmentPreimage: fakeProofA.stateCommitmentPreimage,
                l1VerificationData: fakeProofA.l1VerificationData,
                proofs: [
                    {
                        address: contractA,
                        storageProofs: fakeProofA.storageProofs
                    }
                ]
            }
        });
    });

    rpcUnitTest('returns same id that was provided', async ({ reqContext, rpc }) => {
        setup(rpc);

        const res = await method.handle(
            reqContext,
            'prividium_tokenSupplyDisclosure',
            [tokenAddress, blockNumber],
            requestId
        );

        expect(res).toHaveProperty('id', requestId);
    });

    rpcUnitTest('resolves a block tag and uses the resolved hex downstream', async ({ reqContext, rpc }) => {
        const resolvedHex: Hex = '0x2b';
        setup(rpc);
        rpc.registerResolveBlockNumber(`${requestId}_batchNumber_resolve`, resolvedHex);

        await method.handle(reqContext, 'prividium_tokenSupplyDisclosure', [tokenAddress, 'latest'], requestId);

        expect(rpc.batchForBlockRegistry[0]).toEqual({
            id: `${requestId}_batchNumber`,
            block: 'latest',
            blockNumber: resolvedHex
        });
        expect(rpc.debugCallRegistry[0]).toMatchObject({ blockNumber: resolvedHex });
    });

    rpcUnitTest(
        'propagates WrongArguments when batchForBlock rejects an unbatched block',
        async ({ reqContext, rpc }) => {
            setup(rpc);
            rpc.registerBatchForBlockError(
                `${requestId}_batchNumber`,
                new WrongArguments(`Block ${blockNumber} has not been included in a batch yet`)
            );

            await expect(
                method.handle(reqContext, 'prividium_tokenSupplyDisclosure', [tokenAddress, blockNumber], requestId)
            ).rejects.toThrow(WrongArguments);
        }
    );

    rpcUnitTest(
        'rejects when the requested block is before disclosureStartBlock',
        async ({ reqContext, rpc, authorizer }) => {
            setup(rpc);
            authorizer.setSupplyDisclosureConfig({ disclosureStartBlock: '0x64' });

            await expect(
                method.handle(reqContext, 'prividium_tokenSupplyDisclosure', [tokenAddress, blockNumber], requestId)
            ).rejects.toThrow(/is before disclosure start block 0x64/);
        }
    );
});
