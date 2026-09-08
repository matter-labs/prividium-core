import { describe, expect } from 'vitest';
import { createReceipt } from '../../../../test/rpc/create-receipt';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { ZERO_LOGS_BLOOM } from '../../constants';
import { eth_getTransactionReceipt } from './eth_getTransactionReceipt';

describe('rpc method: eth_getTransactionReceipt', () => {
    const reqId = 'someid';
    const txHash = '0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb';
    const method = eth_getTransactionReceipt;

    rpcUnitTest('returns null when receipt does not exist', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);

        rpc.registerSend(reqId, null);

        const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: null
        });
    });

    rpcUnitTest(
        'returns null when receipt exists but user is not associated',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);

            const receipt = createReceipt(txHash, { from: otherAddress, to: otherAddress });
            rpc.registerSend(reqId, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: null
            });
        }
    );

    rpcUnitTest('returns receipt when user is the sender (from)', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
        authorizer.setUserAddresses([userAddress]);

        const receipt = createReceipt(txHash, { from: userAddress, to: otherAddress });
        rpc.registerSend(reqId, receipt);

        const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: { ...receipt, logsBloom: ZERO_LOGS_BLOOM }
        });
    });

    rpcUnitTest('returns receipt when user is the recipient (to)', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
        authorizer.setUserAddresses([userAddress]);

        const receipt = createReceipt(txHash, { from: otherAddress, to: userAddress });
        rpc.registerSend(reqId, receipt);

        const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: { ...receipt, logsBloom: ZERO_LOGS_BLOOM }
        });
    });

    rpcUnitTest('returns receipt when user address is in log topics', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
        authorizer.setUserAddresses([userAddress]);
        authorizer.setLogPermission([true]);

        const receipt = createReceipt(txHash, {
            from: otherAddress,
            to: otherAddress,
            logTopics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8'
            ]
        });

        rpc.registerSend(reqId, receipt);

        const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: { ...receipt, logsBloom: ZERO_LOGS_BLOOM }
        });
    });

    rpcUnitTest(
        'returns receipt when user has full read access even if not associated',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setFullReadAccess(true);

            const receipt = createReceipt(txHash, { from: otherAddress, to: otherAddress });
            rpc.registerSend(reqId, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: receipt
            });
        }
    );

    rpcUnitTest(
        'returns receipt when user has the eth_getTransactionReceipt rpc read permission even if not associated',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setRpcReadPermissions(['eth_getTransactionReceipt']);

            const receipt = createReceipt(txHash, { from: otherAddress, to: otherAddress });
            rpc.registerSend(reqId, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: receipt
            });
        }
    );

    rpcUnitTest(
        'zeroes logsBloom in receipt when user does not have full read access',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);

            const receipt = createReceipt(txHash, { from: userAddress, to: otherAddress });
            rpc.registerSend(reqId, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: {
                    transactionHash: txHash,
                    logsBloom: ZERO_LOGS_BLOOM
                }
            });
        }
    );

    rpcUnitTest(
        'preserves logsBloom in receipt when user has full read access',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setFullReadAccess(true);

            const receipt = createReceipt(txHash, { from: otherAddress, to: otherAddress });
            rpc.registerSend(reqId, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionReceipt', [txHash], reqId);
            expect((res as unknown as { result: { logsBloom: string } }).result.logsBloom).not.toBe(ZERO_LOGS_BLOOM);
        }
    );
});
