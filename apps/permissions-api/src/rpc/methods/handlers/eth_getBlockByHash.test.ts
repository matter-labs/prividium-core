import { getAddress, pad } from 'viem';
import { describe, expect } from 'vitest';
import { createBlockWithTxDetails, createBlockWithTxHashes } from '../../../../test/rpc/create-blocks';
import { createReceipt } from '../../../../test/rpc/create-receipt';
import { createTransaction } from '../../../../test/rpc/create-transaction';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { ZERO_LOGS_BLOOM } from '../../constants';
import { eth_getBlockByHash } from './eth_getBlock';

describe('rpc method: eth_getBlockByHash', () => {
    const method = eth_getBlockByHash;
    const reqId = 'someid';

    const someTxHash = '0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb';
    rpcUnitTest('filters out transactions when none match user addresses', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);

        rpc.registerSend(reqId, createBlockWithTxDetails());
        rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
        rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash)]);

        const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', true], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: {
                transactions: []
            }
        });
    });

    rpcUnitTest(
        'filters out transactions when no match and second argument is false',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
            authorizer.setUserAddresses([userAddress]);

            rpc.registerSend(reqId, createBlockWithTxHashes());
            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash)]);

            const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', false], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: {
                    transactions: []
                }
            });
        }
    );

    rpcUnitTest(
        'includes transactions when receipt to address matches user',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
            authorizer.setUserAddresses([userAddress]);

            const from = pad('0x01', { size: 20 });
            const tx = createTransaction(someTxHash, { to: userAddress, from });
            const blockData = createBlockWithTxDetails([tx]);

            rpc.registerSend(reqId, blockData);
            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash, { to: userAddress })]);

            const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', true], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: {
                    transactions: blockData.transactions
                }
            });
        }
    );

    rpcUnitTest(
        'includes transactions when receipt from address matches user',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
            authorizer.setUserAddresses([userAddress]);

            const to = pad('0x01', { size: 20 });
            const tx = createTransaction(someTxHash, { to, from: userAddress });
            const blockData = createBlockWithTxDetails([tx]);

            rpc.registerSend(reqId, blockData);
            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash, { from: userAddress })]);

            const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', true], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: {
                    transactions: blockData.transactions
                }
            });
        }
    );

    rpcUnitTest(
        'includes transactions when user has permission to see log',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
            authorizer.setUserAddresses([userAddress]);

            const from = pad('0x02', { size: 20 });
            const to = pad('0x01', { size: 20 });
            const tx = createTransaction(someTxHash, { from, to });
            const blockData = createBlockWithTxDetails([tx]);

            rpc.registerSend(reqId, blockData);
            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [
                createReceipt(someTxHash, {
                    logTopics: [
                        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                        '0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8'
                    ]
                })
            ]);

            authorizer.setLogPermission([true]);

            const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', true], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: {
                    transactions: blockData.transactions
                }
            });
        }
    );

    rpcUnitTest(
        'returns transaction hashes when second param is false and tx matches',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);

            rpc.registerSend(reqId, createBlockWithTxHashes());
            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash, { to: userAddress })]);

            const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', false], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: {
                    transactions: [someTxHash]
                }
            });
        }
    );

    rpcUnitTest('returns all transactions when user has full read access', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);
        authorizer.setFullReadAccess(true);

        const blockData = createBlockWithTxDetails();
        rpc.registerSend(reqId, blockData);

        const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', true], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: blockData
        });
    });

    rpcUnitTest(
        'returns all transactions when user has the eth_getBlockByHash rpc read permission',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setRpcReadPermissions(['eth_getBlockByHash']);

            const blockData = createBlockWithTxDetails();
            rpc.registerSend(reqId, blockData);

            const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', true], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: blockData
            });
        }
    );

    rpcUnitTest(
        'zeroes logsBloom when user does not have full read access',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
            authorizer.setUserAddresses([userAddress]);

            const from = pad('0x01', { size: 20 });
            const tx = createTransaction(someTxHash, { to: userAddress, from });
            const blockData = createBlockWithTxDetails([tx]);

            rpc.registerSend(reqId, blockData);
            rpc.registerSend(`${reqId}_getBlockByHash`, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash, { to: userAddress })]);

            const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', true], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: {
                    logsBloom: ZERO_LOGS_BLOOM
                }
            });
        }
    );

    rpcUnitTest(
        'preserves original logsBloom when user has full read access',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setFullReadAccess(true);

            const blockData = createBlockWithTxDetails();
            rpc.registerSend(reqId, blockData);

            const res = await method.handle(reqContext, 'eth_getBlockByHash', ['0x1d1551', true], reqId);
            expect((res as unknown as { result: { logsBloom: string } }).result.logsBloom).not.toBe(ZERO_LOGS_BLOOM);
        }
    );
});
