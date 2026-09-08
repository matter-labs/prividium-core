import { getAddress, pad } from 'viem';
import { describe, expect } from 'vitest';
import { createBlockWithTxDetails, createBlockWithTxHashes } from '../../../../test/rpc/create-blocks';
import { createReceipt } from '../../../../test/rpc/create-receipt';
import { createTransaction } from '../../../../test/rpc/create-transaction';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { ZERO_LOGS_BLOOM } from '../../constants';
import { eth_getBlockByNumber } from './eth_getBlock';

describe('rpc method: eth_getBlockByNumber', () => {
    const reqId = 'someid';
    const someTxHash = '0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb';
    const method = eth_getBlockByNumber;

    rpcUnitTest('filters out transactions when none match user addresses', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
        authorizer.setUserAddresses([userAddress]);

        rpc.registerSend(reqId, createBlockWithTxDetails());
        rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash)]);

        const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', true], reqId);
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
            rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash)]);

            const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', false], reqId);
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
            const tx = createTransaction(someTxHash, {
                from,
                to: userAddress
            });

            const blockData = createBlockWithTxDetails([tx]);
            rpc.registerSend(reqId, blockData);
            rpc.registerSend(`${reqId}_getBlockReceipts`, [
                createReceipt(someTxHash, {
                    from,
                    to: userAddress
                })
            ]);

            const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', true], reqId);
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

            const to = getAddress(pad('0x01', { size: 20 }));

            const tx = createTransaction(someTxHash, {
                from: userAddress,
                to
            });

            const blockData = createBlockWithTxDetails([tx]);
            rpc.registerSend(reqId, blockData);
            rpc.registerSend(`${reqId}_getBlockReceipts`, [
                createReceipt(someTxHash, {
                    from: userAddress,
                    to
                })
            ]);

            const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', true], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: {
                    transactions: blockData.transactions
                }
            });
        }
    );

    rpcUnitTest('includes transactions when check logs returns true', async ({ reqContext, rpc, authorizer }) => {
        const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
        authorizer.setUserAddresses([userAddress]);

        const from = pad('0x01', { size: 20 });
        const to = pad('0x02', { size: 20 });
        const tx = createTransaction(someTxHash, {
            from: from,
            to: to
        });
        const blockData = createBlockWithTxDetails([tx]);
        rpc.registerSend(reqId, blockData);
        rpc.registerSend(`${reqId}_getBlockReceipts`, [
            createReceipt(someTxHash, {
                logTopics: [
                    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                    '0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8'
                ],
                from,
                to
            })
        ]);

        authorizer.setLogPermission([true]);

        const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', true], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: {
                transactions: [{ ...blockData.transactions[0], input: '0x' }]
            }
        });
    });

    rpcUnitTest(
        'returns transaction hashes when second param is false and tx matches',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);

            rpc.registerSend(reqId, createBlockWithTxHashes());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash, { to: userAddress })]);

            const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', false], reqId);
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

        const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', true], reqId);
        expect(res).toMatchObject({
            id: reqId,
            result: blockData
        });
    });

    rpcUnitTest(
        'returns all transactions when user has the eth_getBlockByNumber rpc read permission',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);
            authorizer.setRpcReadPermissions(['eth_getBlockByNumber']);

            const blockData = createBlockWithTxDetails();
            rpc.registerSend(reqId, blockData);

            const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', true], reqId);
            expect(res).toMatchObject({
                id: reqId,
                result: blockData
            });
        }
    );

    rpcUnitTest(
        'zeroes logsBloom when user does not have full read access',
        async ({ reqContext, rpc, authorizer }) => {
            const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
            authorizer.setUserAddresses([userAddress]);

            rpc.registerSend(reqId, createBlockWithTxDetails());
            rpc.registerSend(`${reqId}_getBlockReceipts`, [createReceipt(someTxHash, { to: userAddress })]);

            const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', true], reqId);
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

            const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['0x1d1551', true], reqId);
            expect((res as unknown as { result: { logsBloom: string } }).result.logsBloom).not.toBe(ZERO_LOGS_BLOOM);
        }
    );

    describe('when block is pending', () => {
        rpcUnitTest(
            'returns all transactions when user has full read access',
            async ({ reqContext, rpc, authorizer }) => {
                const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
                authorizer.setUserAddresses([userAddress]);
                authorizer.setFullReadAccess(true);

                const blockData = createBlockWithTxDetails();
                rpc.registerSend(reqId, blockData);

                const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['pending', true], reqId);
                expect(res).toMatchObject({
                    id: reqId,
                    result: blockData
                });
            }
        );

        rpcUnitTest(
            'returns all transactions when user has the eth_getBlockByNumber rpc read permission',
            async ({ reqContext, rpc, authorizer }) => {
                const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
                authorizer.setUserAddresses([userAddress]);
                authorizer.setRpcReadPermissions(['eth_getBlockByNumber']);

                const blockData = createBlockWithTxDetails();
                rpc.registerSend(reqId, blockData);

                const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['pending', true], reqId);
                expect(res).toMatchObject({
                    id: reqId,
                    result: blockData
                });
            }
        );

        rpcUnitTest(
            'returns all tx hashes when user has full read access and compact response was specified',
            async ({ reqContext, rpc, authorizer }) => {
                const userAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
                authorizer.setUserAddresses([userAddress]);
                authorizer.setFullReadAccess(true);

                const blockData = createBlockWithTxDetails();
                rpc.registerSend(reqId, blockData);

                const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['pending', false], reqId);
                expect(res).toMatchObject({
                    id: reqId,
                    result: createBlockWithTxHashes()
                });
            }
        );

        rpcUnitTest(
            'includes transactions when "from" address matches user',
            async ({ reqContext, rpc, authorizer }) => {
                const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
                authorizer.setUserAddresses([userAddress]);

                const to = getAddress(pad('0x01', { size: 20 }));

                const tx = createTransaction(someTxHash, {
                    from: userAddress,
                    to
                });

                const blockData = createBlockWithTxDetails([tx]);
                rpc.registerSend(reqId, blockData);

                const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['pending', true], reqId);
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

                const anotherAddress = getAddress(pad('0x01', { size: 20 }));

                const tx = createTransaction(someTxHash, {
                    from: anotherAddress,
                    to: userAddress
                });

                const blockData = createBlockWithTxDetails([tx]);
                rpc.registerSend(reqId, blockData);

                const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['pending', true], reqId);
                expect(res).toMatchObject({
                    id: reqId,
                    result: {
                        transactions: blockData.transactions
                    }
                });
            }
        );

        rpcUnitTest(
            'excludes transactions where from and to dont match current user',
            async ({ reqContext, rpc, authorizer }) => {
                const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
                authorizer.setUserAddresses([userAddress]);
                authorizer.setFullReadAccess(false);

                const anotherAddress = getAddress(pad('0x01', { size: 20 }));

                const tx1 = createTransaction(pad('0x10'), {
                    from: anotherAddress,
                    to: userAddress
                });

                const tx2 = createTransaction(pad('0x11'), {
                    from: userAddress,
                    to: anotherAddress
                });

                const tx3 = createTransaction(pad('0x12'), {
                    from: anotherAddress,
                    to: anotherAddress
                });

                const blockData = createBlockWithTxDetails([tx1, tx2, tx3]);
                rpc.registerSend(reqId, blockData);

                const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['pending', false], reqId);
                expect(res).toMatchObject({
                    id: reqId,
                    result: {
                        transactions: [tx1.hash, tx2.hash]
                    }
                });
            }
        );

        rpcUnitTest(
            'zeroes logsBloom for pending block when user does not have full read access',
            async ({ reqContext, rpc, authorizer }) => {
                const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
                authorizer.setUserAddresses([userAddress]);

                const to = getAddress(pad('0x01', { size: 20 }));

                const tx = createTransaction(someTxHash, {
                    from: userAddress,
                    to
                });

                const blockData = createBlockWithTxDetails([tx]);
                rpc.registerSend(reqId, blockData);

                const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['pending', true], reqId);
                expect(res).toMatchObject({
                    id: reqId,
                    result: {
                        logsBloom: ZERO_LOGS_BLOOM
                    }
                });
            }
        );

        rpcUnitTest(
            'when transaction_detail_flag is false returns only tx hashes',
            async ({ reqContext, rpc, authorizer }) => {
                const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
                authorizer.setUserAddresses([userAddress]);

                const anotherAddress = getAddress(pad('0x01', { size: 20 }));

                const tx = createTransaction(someTxHash, {
                    from: anotherAddress,
                    to: userAddress
                });

                const blockData = createBlockWithTxDetails([tx]);
                rpc.registerSend(reqId, blockData);

                const res = await method.handle(reqContext, 'eth_getBlockByNumber', ['pending', false], reqId);
                expect(res).toMatchObject({
                    id: reqId,
                    result: {
                        transactions: blockData.transactions.map((tx) => tx.hash)
                    }
                });
            }
        );
    });
});
