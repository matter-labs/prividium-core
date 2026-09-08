import { describe, expect } from 'vitest';
import { createReceipt } from '../../../../test/rpc/create-receipt';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { ZERO_LOGS_BLOOM } from '../../constants';
import { eth_getBlockReceipts } from './eth_getBlockReceipts';

describe('rpc method: eth_getBlockReceipts', () => {
    const reqId = 'someid';
    const txHash1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const txHash2 = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const method = eth_getBlockReceipts;

    rpcUnitTest('returns null when block receipts do not exist', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);

        rpc.registerSend(reqId, null);

        const res = await method.handle(reqContext, 'eth_getBlockReceipts', ['0x1d1551'], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: null
        });
    });

    rpcUnitTest(
        'returns empty array when no receipts match user addresses',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);

            const receipts = [
                createReceipt(txHash1, { from: otherAddress, to: otherAddress }),
                createReceipt(txHash2, { from: otherAddress, to: otherAddress })
            ];
            rpc.registerSend(reqId, receipts);

            const res = await method.handle(reqContext, 'eth_getBlockReceipts', ['0x1d1551'], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: []
            });
        }
    );

    rpcUnitTest('returns receipts when user is associated', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
        authorizer.setUserAddresses([userAddress]);

        const receipt1 = createReceipt(txHash1, { from: userAddress, to: otherAddress });
        const receipt2 = createReceipt(txHash2, { from: otherAddress, to: otherAddress });
        rpc.registerSend(reqId, [receipt1, receipt2]);

        const res = await method.handle(reqContext, 'eth_getBlockReceipts', ['0x1d1551'], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: [{ ...receipt1, logsBloom: ZERO_LOGS_BLOOM }]
        });
    });

    rpcUnitTest('returns all receipts when user has full read access', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
        authorizer.setUserAddresses([userAddress]);
        authorizer.setFullReadAccess(true);

        const receipts = [
            createReceipt(txHash1, { from: otherAddress, to: otherAddress }),
            createReceipt(txHash2, { from: otherAddress, to: otherAddress })
        ];
        rpc.registerSend(reqId, receipts);

        const res = await method.handle(reqContext, 'eth_getBlockReceipts', ['0x1d1551'], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: receipts
        });
    });

    rpcUnitTest(
        'zeroes logsBloom in returned receipts when user does not have full read access',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);

            const receipt1 = createReceipt(txHash1, { from: userAddress, to: otherAddress });
            rpc.registerSend(reqId, [receipt1]);

            const res = await method.handle(reqContext, 'eth_getBlockReceipts', ['0x1d1551'], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: [
                    {
                        transactionHash: txHash1,
                        logsBloom: ZERO_LOGS_BLOOM
                    }
                ]
            });
        }
    );

    rpcUnitTest(
        'preserves logsBloom in receipts when user has full read access',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setFullReadAccess(true);

            const receipt1 = createReceipt(txHash1, { from: otherAddress, to: otherAddress });
            rpc.registerSend(reqId, [receipt1]);

            const res = await method.handle(reqContext, 'eth_getBlockReceipts', ['0x1d1551'], reqId);
            expect(
                ((res as unknown as { result: Array<{ logsBloom: string }> }).result[0] as { logsBloom: string })
                    .logsBloom
            ).not.toBe(ZERO_LOGS_BLOOM);
        }
    );
});
