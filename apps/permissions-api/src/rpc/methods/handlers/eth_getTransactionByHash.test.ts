import { describe, expect } from 'vitest';
import { createReceipt } from '../../../../test/rpc/create-receipt';
import { createTransaction } from '../../../../test/rpc/create-transaction';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { eth_getTransactionByHash } from './eth_getTransactionByHash';

describe('rpc method: eth_getTransactionByHash', () => {
    const reqId = 'someid';
    const txHash = '0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb';
    const method = eth_getTransactionByHash;

    rpcUnitTest('returns null when transaction does not exist', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);

        rpc.registerSend(reqId, null);
        rpc.registerSend(`${reqId}_receipt`, null);

        const res = await method.handle(reqContext, 'eth_getTransactionByHash', [txHash], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: null
        });
    });

    rpcUnitTest(
        'returns null when transaction exists but user is not associated',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);

            const transaction = createTransaction(txHash, { from: otherAddress, to: otherAddress });
            const receipt = createReceipt(txHash, { from: otherAddress, to: otherAddress });

            rpc.registerSend(reqId, transaction);
            rpc.registerSend(`${reqId}_receipt`, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionByHash', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: null
            });
        }
    );

    rpcUnitTest('returns transaction when user is the sender (from)', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
        authorizer.setUserAddresses([userAddress]);

        const transaction = createTransaction(txHash, { from: userAddress, to: otherAddress });
        const receipt = createReceipt(txHash, { from: userAddress, to: otherAddress });

        rpc.registerSend(reqId, transaction);
        rpc.registerSend(`${reqId}_receipt`, receipt);

        const res = await method.handle(reqContext, 'eth_getTransactionByHash', [txHash], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: transaction
        });
    });

    rpcUnitTest('returns transaction when user is the recipient (to)', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
        authorizer.setUserAddresses([userAddress]);

        const transaction = createTransaction(txHash, { from: otherAddress, to: userAddress });
        const receipt = createReceipt(txHash, { from: otherAddress, to: userAddress });

        rpc.registerSend(reqId, transaction);
        rpc.registerSend(`${reqId}_receipt`, receipt);

        const res = await method.handle(reqContext, 'eth_getTransactionByHash', [txHash], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: transaction
        });
    });

    rpcUnitTest(
        'returns filtered transaction permission api allows to see some log',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);

            const transaction = createTransaction(txHash, { from: otherAddress, to: otherAddress });
            const receipt = createReceipt(txHash, {
                from: otherAddress,
                to: otherAddress,
                logTopics: [
                    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                    '0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8'
                ]
            });

            authorizer.setLogPermission([true]);
            rpc.registerSend(reqId, transaction);
            rpc.registerSend(`${reqId}_receipt`, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionByHash', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: { ...transaction, input: '0x' }
            });
        }
    );

    rpcUnitTest(
        'returns transaction when matches but receipt is not available',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);

            const transaction = createTransaction(txHash, { from: userAddress, to: userAddress });

            rpc.registerSend(reqId, transaction);
            rpc.registerSend(`${reqId}_receipt`, null);

            const res = await method.handle(reqContext, 'eth_getTransactionByHash', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: transaction
            });
        }
    );

    rpcUnitTest(
        'returns transaction when user has full read access even if not associated',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setFullReadAccess(true);

            const transaction = createTransaction(txHash, { from: otherAddress, to: otherAddress });
            const receipt = createReceipt(txHash, { from: otherAddress, to: otherAddress });

            rpc.registerSend(reqId, transaction);
            rpc.registerSend(`${reqId}_receipt`, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionByHash', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: transaction
            });
        }
    );

    rpcUnitTest(
        'returns transaction when user has the eth_getTransactionByHash rpc read permission even if not associated',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            const otherAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setRpcReadPermissions(['eth_getTransactionByHash']);

            const transaction = createTransaction(txHash, { from: otherAddress, to: otherAddress });
            const receipt = createReceipt(txHash, { from: otherAddress, to: otherAddress });

            rpc.registerSend(reqId, transaction);
            rpc.registerSend(`${reqId}_receipt`, receipt);

            const res = await method.handle(reqContext, 'eth_getTransactionByHash', [txHash], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: transaction
            });
        }
    );
});
