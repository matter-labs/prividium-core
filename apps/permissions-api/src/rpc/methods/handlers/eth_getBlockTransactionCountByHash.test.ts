import { describe, expect } from 'vitest';
import { createBlockWithTxDetails, createBlockWithTxHashes } from '../../../../test/rpc/create-blocks';
import { createReceipt } from '../../../../test/rpc/create-receipt';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { eth_getBlockTransactionCountByHash } from './eth_getBlock';

describe('rpc method: eth_getBlockTransactionCountByHash', () => {
    const reqId = 'someid';
    const method = eth_getBlockTransactionCountByHash;

    rpcUnitTest('returns 0 when no transactions match user addresses', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);

        rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
        rpc.registerSend(`${reqId}_getBlockReceipts`, [
            createReceipt('0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb')
        ]);

        const res = await method.handle(reqContext, 'eth_getBlockTransactionCountByHash', ['0xabc123'], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: '0x0'
        });
    });

    rpcUnitTest(
        'returns 0 when block has transaction hashes but none match',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);

            rpc.registerSend(reqId, createBlockWithTxHashes());
            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [
                createReceipt('0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb')
            ]);

            const res = await method.handle(reqContext, 'eth_getBlockTransactionCountByHash', ['0xabc123'], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: '0x0'
            });
        }
    );

    rpcUnitTest('returns 1 when receipt to address matches user', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);

        rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
        rpc.registerSend(`${reqId}_getBlockReceipts`, [
            createReceipt('0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb', { to: userAddress })
        ]);

        const res = await method.handle(reqContext, 'eth_getBlockTransactionCountByHash', ['0xabc123'], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: '0x1'
        });
    });

    rpcUnitTest('returns 1 when receipt from address matches user', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);

        rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
        rpc.registerSend(`${reqId}_getBlockReceipts`, [
            createReceipt('0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb', { from: userAddress })
        ]);

        const res = await method.handle(reqContext, 'eth_getBlockTransactionCountByHash', ['0xabc123'], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: '0x1'
        });
    });

    rpcUnitTest(
        'returns elements when permissions-api returns user can see the logs',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);

            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [
                createReceipt('0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb', {
                    logTopics: [
                        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                        '0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8'
                    ]
                })
            ]);

            authorizer.setLogPermission([true]);

            const res = await method.handle(reqContext, 'eth_getBlockTransactionCountByHash', ['0xabc123'], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: '0x1'
            });
        }
    );

    rpcUnitTest(
        'returns correct count when block has multiple transactions that match',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);

            const tx1 = {
                type: '0x0',
                chainId: '0x10e',
                nonce: '0x0',
                gasPrice: '0x4b0',
                gas: '0x1e8480',
                to: '0xe441cf0795af14ddb9f7984da85cd36db1b8790d',
                value: '0x0',
                input: '0x',
                r: '0x12eeffd990a4b8795877afb8dfd923bbe7d81423fd236e9126d2007660c87160',
                s: '0x2024564739889b5e50bbcd11bc26ee3691d43f2d192b0f28cf439bbddf6ed529',
                v: '0x23f',
                hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
                blockHash: '0xee102b9995c3034c738d9c5050351c0c54e667bbe371fac8caa0b39212796976',
                blockNumber: '0x7',
                transactionIndex: '0x0',
                from: '0x69a5315b1ff226eda15c40c2816d759597860bc7'
            } as const;

            const tx2 = {
                ...tx1,
                hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
                transactionIndex: '0x1'
            } as const;

            const tx3 = {
                ...tx1,
                hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
                transactionIndex: '0x2'
            } as const;

            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails([tx1, tx2, tx3]));
            rpc.registerSend(`${reqId}_getBlockReceipts`, [
                createReceipt('0x1111111111111111111111111111111111111111111111111111111111111111', {
                    to: userAddress
                }),
                createReceipt('0x2222222222222222222222222222222222222222222222222222222222222222'),
                createReceipt('0x3333333333333333333333333333333333333333333333333333333333333333', {
                    from: userAddress
                })
            ]);

            const res = await method.handle(reqContext, 'eth_getBlockTransactionCountByHash', ['0xabc123'], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: '0x2'
            });
        }
    );

    rpcUnitTest(
        'returns full transaction count when user has full read access',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setFullReadAccess(true);

            const tx1 = {
                type: '0x0',
                chainId: '0x10e',
                nonce: '0x0',
                gasPrice: '0x4b0',
                gas: '0x1e8480',
                to: '0xe441cf0795af14ddb9f7984da85cd36db1b8790d',
                value: '0x0',
                input: '0x',
                r: '0x12eeffd990a4b8795877afb8dfd923bbe7d81423fd236e9126d2007660c87160',
                s: '0x2024564739889b5e50bbcd11bc26ee3691d43f2d192b0f28cf439bbddf6ed529',
                v: '0x23f',
                hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
                blockHash: '0xee102b9995c3034c738d9c5050351c0c54e667bbe371fac8caa0b39212796976',
                blockNumber: '0x7',
                transactionIndex: '0x0',
                from: '0x69a5315b1ff226eda15c40c2816d759597860bc7'
            } as const;

            const tx2 = {
                ...tx1,
                hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
                transactionIndex: '0x1'
            } as const;

            const tx3 = {
                ...tx1,
                hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
                transactionIndex: '0x2'
            } as const;

            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails([tx1, tx2, tx3]));

            const res = await method.handle(reqContext, 'eth_getBlockTransactionCountByHash', ['0xabc123'], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: '0x3'
            });
        }
    );

    rpcUnitTest('returns null when block does not exist', async ({ reqContext, rpc, authorizer }) => {
        authorizer.setUserAddresses(['0x70997970c51812dc3a010c7d01b50e0d17dc79c8']);

        rpc.registerSend(`${reqId}_getBlockByHash`, null);

        const res = await method.handle(reqContext, 'eth_getBlockTransactionCountByHash', ['0xabc123'], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: null
        });
    });
});
