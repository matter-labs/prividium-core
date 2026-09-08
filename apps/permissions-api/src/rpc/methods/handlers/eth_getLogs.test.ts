import { type Hex, pad } from 'viem';
import { describe, expect } from 'vitest';
import { z } from 'zod';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { eth_getLogs } from './eth_getLogs';

describe('rpc method: eth_getBlockByNumber', () => {
    const method = eth_getLogs;

    const successSchema = z.object({ result: z.any() });

    rpcUnitTest('when no logs are returned returns empty list', async ({ reqContext, rpc }) => {
        const reqId = 'someId';
        rpc.registerSend(reqId, []);

        const res = await method.handle(
            reqContext,
            'eth_getLogs',
            [
                {
                    fromBlock: 'latest',
                    address: '0x000000000000000000000000000000000000800A',
                    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
                }
            ],
            reqId
        );

        const success = successSchema.parse(res);

        expect(success.result).toEqual([]);
    });

    function logForWithTopics(topics: Hex[], txHash: Hex) {
        return {
            address: '0x000000000000000000000000000000000000800a',
            topics: topics.map((hex) => pad(hex)),
            data: '0x0000000000000000000000000000000000000000000000000000245eb1972b40',
            blockHash: '0xe1adfa22ddfadd0ed4bd0c4770e8a8c53b140312b3b0d463fa97c15f57b3066a',
            blockNumber: '0x5747bf',
            l1BatchNumber: null,
            transactionHash: txHash,
            transactionIndex: '0x0',
            logIndex: '0x0',
            transactionLogIndex: '0x0',
            logType: null,
            removed: false,
            blockTimestamp: '0x68b886cd'
        };
    }

    rpcUnitTest(
        'when permission api returns false for all returns empty reponse',
        async ({ reqContext, rpc, authorizer }) => {
            const reqId = 'someId';
            const userAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
            const otherAddress = pad('0x01', { size: 20 });
            const logForUser = logForWithTopics([userAddress], '0x02');

            authorizer.setUserAddresses([userAddress]);

            rpc.registerSend(reqId, [
                logForWithTopics([], '0x01'),
                logForUser,
                logForWithTopics([otherAddress], '0x03')
            ]);
            authorizer.setLogPermission([false, false, false]);

            const res = await method.handle(
                reqContext,
                'eth_getLogs',
                [
                    {
                        fromBlock: 'latest',
                        address: '0x000000000000000000000000000000000000800A',
                        topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
                    }
                ],
                reqId
            );

            const success = successSchema.parse(res);

            expect(success.result).toEqual([]);
        }
    );

    rpcUnitTest(
        'when permission api returns true for all returns full response',
        async ({ reqContext, rpc, authorizer }) => {
            const reqId = 'someId';
            const userAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
            const otherAddress = pad('0x01', { size: 20 });
            const logForUser = logForWithTopics([userAddress], '0x02');

            authorizer.setUserAddresses([userAddress]);

            const logs = [logForWithTopics([], '0x01'), logForUser, logForWithTopics([otherAddress], '0x03')];
            rpc.registerSend(reqId, logs);

            authorizer.setLogPermission([true, true, true]);
            const res = await method.handle(
                reqContext,
                'eth_getLogs',
                [
                    {
                        fromBlock: 'latest',
                        address: '0x000000000000000000000000000000000000800A',
                        topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
                    }
                ],
                reqId
            );

            const success = successSchema.parse(res);

            expect(success.result).toEqual(logs);
        }
    );

    rpcUnitTest(
        'when permission service returns true for some topics returns those logs',
        async ({ reqContext, rpc, authorizer }) => {
            const reqId = 'someId';
            const userAddresses: [Hex, Hex] = [
                '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
            ];
            const otherAddress = pad('0x01', { size: 20 });
            const logForUser1 = logForWithTopics([userAddresses[0]], '0x02');
            const logForUser2 = logForWithTopics(['0x', userAddresses[1]], '0x03');
            const logForUser3 = logForWithTopics(['0x11', '0xaa', userAddresses[0]], '0x04');

            rpc.registerSend(reqId, [
                logForWithTopics([], '0x01'),
                logForUser1,
                logForUser2,
                logForUser3,
                logForWithTopics([otherAddress], '0x05')
            ]);
            authorizer.setLogPermission([false, true, true, true, false]);

            const res = await method.handle(
                reqContext,
                'eth_getLogs',
                [
                    {
                        fromBlock: 'latest',
                        address: '0x000000000000000000000000000000000000800A',
                        topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
                    }
                ],
                reqId
            );

            const success = successSchema.parse(res);

            expect(success.result).toHaveLength(3);
            // Keeps relative order
            expect(success.result).toEqual([logForUser1, logForUser2, logForUser3]);
        }
    );

    rpcUnitTest('returns all logs when user has full read access', async ({ reqContext, rpc, authorizer }) => {
        const reqId = 'someId';
        const userAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
        const otherAddress = pad('0x01', { size: 20 });

        authorizer.setUserAddresses([userAddress]);
        authorizer.setFullReadAccess(true);

        const logs = [logForWithTopics([], '0x01'), logForWithTopics([otherAddress], '0x02')];
        rpc.registerSend(reqId, logs);

        const res = await method.handle(reqContext, 'eth_getLogs', [{ fromBlock: 'latest' }], reqId);
        const success = successSchema.parse(res);
        expect(success.result).toEqual(logs);
    });

    rpcUnitTest(
        'returns all logs when user has the eth_getLogs rpc read permission',
        async ({ reqContext, rpc, authorizer }) => {
            const reqId = 'someId';
            const userAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
            const otherAddress = pad('0x01', { size: 20 });

            authorizer.setUserAddresses([userAddress]);
            authorizer.setRpcReadPermissions(['eth_getLogs']);
            authorizer.setCouldQueryMatch(false);

            const logs = [logForWithTopics([], '0x01'), logForWithTopics([otherAddress], '0x02')];
            rpc.registerSend(reqId, logs);

            const res = await method.handle(reqContext, 'eth_getLogs', [{ fromBlock: 'latest' }], reqId);
            const success = successSchema.parse(res);

            expect(success.result).toEqual(logs);
            expect(rpc.sendRegistry).toHaveLength(1);
        }
    );

    rpcUnitTest(
        'returns empty without calling sequencer when query cannot match permissions',
        async ({ reqContext, rpc, authorizer }) => {
            const reqId = 'someId';

            authorizer.setCouldQueryMatch(false);

            const res = await method.handle(
                reqContext,
                'eth_getLogs',
                [
                    {
                        fromBlock: 'latest',
                        address: '0x000000000000000000000000000000000000800A',
                        topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
                    }
                ],
                reqId
            );

            const success = successSchema.parse(res);

            // Should return empty array without calling sequencer
            expect(success.result).toEqual([]);
            // Verify sequencer was NOT called
            expect(rpc.sendRegistry).toHaveLength(0);
        }
    );

    rpcUnitTest('calls sequencer when query could match permissions', async ({ reqContext, rpc, authorizer }) => {
        const reqId = 'someId';
        const userAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

        authorizer.setCouldQueryMatch(true);

        const logs = [logForWithTopics([userAddress], '0x01')];
        rpc.registerSend(reqId, logs);

        authorizer.setLogPermission([true]);

        const res = await method.handle(
            reqContext,
            'eth_getLogs',
            [
                {
                    fromBlock: 'latest',
                    address: '0x000000000000000000000000000000000000800A',
                    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
                }
            ],
            reqId
        );

        const success = successSchema.parse(res);

        // Should return filtered logs
        expect(success.result).toEqual(logs);
        // Verify sequencer WAS called
        expect(rpc.sendRegistry).toHaveLength(1);
    });

    rpcUnitTest(
        'full read access bypasses permission check and queries sequencer directly',
        async ({ reqContext, rpc, authorizer }) => {
            const reqId = 'someId';

            authorizer.setFullReadAccess(true);

            authorizer.setCouldQueryMatch(false);

            const logs = [logForWithTopics([], '0x01')];
            rpc.registerSend(reqId, logs);

            const res = await method.handle(reqContext, 'eth_getLogs', [{ fromBlock: 'latest' }], reqId);
            const success = successSchema.parse(res);

            expect(success.result).toEqual(logs);
            // Verify sequencer WAS called despite couldQueryMatch being false
            expect(rpc.sendRegistry).toHaveLength(1);
        }
    );

    rpcUnitTest(
        'returns empty when couldMatch is true but post-filtering removes all logs',
        async ({ reqContext, rpc, authorizer }) => {
            const reqId = 'someId';
            const otherAddress = pad('0x01', { size: 20 });

            authorizer.setCouldQueryMatch(true);

            const logs = [
                logForWithTopics([otherAddress], '0x01'),
                logForWithTopics([otherAddress], '0x02'),
                logForWithTopics([otherAddress], '0x03')
            ];
            rpc.registerSend(reqId, logs);

            authorizer.setLogPermission([false, false, false]);

            const res = await method.handle(
                reqContext,
                'eth_getLogs',
                [
                    {
                        fromBlock: 'latest',
                        address: '0x000000000000000000000000000000000000800A',
                        topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
                    }
                ],
                reqId
            );

            const success = successSchema.parse(res);

            // Should return empty after post-filtering
            expect(success.result).toEqual([]);
            // Verify sequencer WAS called (pre-flight passed)
            expect(rpc.sendRegistry).toHaveLength(1);
        }
    );
});
