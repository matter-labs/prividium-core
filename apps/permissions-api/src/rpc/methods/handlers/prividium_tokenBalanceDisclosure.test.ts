import { encodeFunctionData, type Hex, numberToHex, pad, parseAbiItem, zeroAddress } from 'viem';
import { describe, expect } from 'vitest';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import type { TestExternalRpc } from '../../../../test/rpc/test-external-rpc';
import { ForbiddenRpcError } from '../../errors';
import type { ZksGetProofResponse } from '../../target-rpc';
import { prividium_tokenBalanceDisclosure } from './prividium_tokenBalanceDisclosure';

const method = prividium_tokenBalanceDisclosure;
const tokenAddress: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const holderAddress: Hex = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const blockNumber: Hex = '0x1a';
const requestId = 'req1';

const balanceOfAbi = [parseAbiItem('function balanceOf(address _owner) public view returns (uint256 balance)')];
const expectedCallData = encodeFunctionData({
    abi: balanceOfAbi,
    functionName: 'balanceOf',
    args: [holderAddress]
});

const contractA: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const slotRawA1 = '0000000000000000000000000000000000000000000000000000000000000003';

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
            proof: { type: 'existing', index: 0, value: '0x0a', nextIndex: 1, siblings: [] }
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
        value: '0x0a',
        reads: {
            [contractA]: [slotRawA1]
        },
        addresses: [contractA]
    });
    rpc.registerBatchForBlock(`${requestId}_batchNumber`, fakeBatchNumber);
    rpc.registerGetProf(`${requestId}_proof_${contractA}`, fakeProofA);
}

describe('rpc method: prividium_tokenBalanceDisclosure', () => {
    rpcUnitTest('rejects when holder address is not disclosed', async ({ reqContext, authorizer }) => {
        authorizer.setBalanceDisclosureConfig(null);

        await expect(
            method.handle(
                reqContext,
                'prividium_tokenBalanceDisclosure',
                [tokenAddress, holderAddress, blockNumber],
                requestId
            )
        ).rejects.toThrow(ForbiddenRpcError);
    });

    rpcUnitTest('debugCall is called with the correct arguments', async ({ reqContext, rpc }) => {
        setup(rpc);

        await method.handle(
            reqContext,
            'prividium_tokenBalanceDisclosure',
            [tokenAddress, holderAddress, blockNumber],
            requestId
        );

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

        await method.handle(
            reqContext,
            'prividium_tokenBalanceDisclosure',
            [tokenAddress, holderAddress, blockNumber],
            requestId
        );

        expect(rpc.batchForBlockRegistry).toHaveLength(1);
        expect(rpc.batchForBlockRegistry[0]).toEqual({
            id: `${requestId}_batchNumber`,
            block: blockNumber,
            blockNumber
        });
    });

    rpcUnitTest('getProf is called once per contract returned by debugCall', async ({ reqContext, rpc }) => {
        setup(rpc);

        await method.handle(
            reqContext,
            'prividium_tokenBalanceDisclosure',
            [tokenAddress, holderAddress, blockNumber],
            requestId
        );

        expect(rpc.getProfRegistry).toHaveLength(1);
        expect(rpc.getProfRegistry[0]).toEqual({
            id: `${requestId}_proof_${contractA}`,
            address: contractA,
            slotList: [pad(numberToHex(BigInt(`0x${slotRawA1}`)))],
            batchNumber: fakeBatchNumber
        });
    });

    rpcUnitTest('returns the correct response shape', async ({ reqContext, rpc }) => {
        setup(rpc);

        const res = await method.handle(
            reqContext,
            'prividium_tokenBalanceDisclosure',
            [tokenAddress, holderAddress, blockNumber],
            requestId
        );

        expect(res).toEqual({
            jsonrpc: '2.0',
            id: requestId,
            result: {
                result: numberToHex(BigInt('0x0a')),
                from: zeroAddress,
                to: tokenAddress,
                callData: expectedCallData,
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
            'prividium_tokenBalanceDisclosure',
            [tokenAddress, holderAddress, blockNumber],
            requestId
        );

        expect(res).toHaveProperty('id', requestId);
    });

    rpcUnitTest(
        'rejects when the requested block is before disclosureStartBlock',
        async ({ reqContext, rpc, authorizer }) => {
            setup(rpc);
            authorizer.setBalanceDisclosureConfig({ disclosureStartBlock: '0x64' });

            await expect(
                method.handle(
                    reqContext,
                    'prividium_tokenBalanceDisclosure',
                    [tokenAddress, holderAddress, blockNumber],
                    requestId
                )
            ).rejects.toThrow(/is before disclosure start block 0x64/);
        }
    );
});
