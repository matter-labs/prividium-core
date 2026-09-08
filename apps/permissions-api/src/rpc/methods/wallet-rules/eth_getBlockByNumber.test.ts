import { describe, expect } from 'vitest';
import { createBlockWithTxHashes } from '../../../../test/rpc/create-blocks';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { response } from '../../json-rpc';
import type { WalletContext } from '../../rpc-service';
import { eth_getBlockByNumber } from './eth_getBlockByNumber';

describe('wallet rule: eth_getBlockByNumber', () => {
    const reqId = 'blk';

    rpcUnitTest('passes baseFeePerGas through but nothing else (privacy)', async ({ reqContext, rpc }) => {
        rpc.registerDelegate(reqId, response({ id: reqId, result: createBlockWithTxHashes() }));
        const res = await eth_getBlockByNumber.handle(
            reqContext as unknown as WalletContext,
            'eth_getBlockByNumber',
            ['latest', false],
            reqId
        );
        expect(res).toMatchObject({
            id: reqId,
            result: {
                number: '0x7',
                baseFeePerGas: '0x3e8',
                // gasUsed/timestamp must stay hardcoded — real values would leak hidden block activity
                gasUsed: '0x0',
                timestamp: '0x0',
                transactions: []
            }
        });
    });

    rpcUnitTest('omits baseFeePerGas when the source block has none', async ({ reqContext, rpc }) => {
        const { baseFeePerGas: _drop, ...noBaseFee } = createBlockWithTxHashes();
        rpc.registerDelegate(reqId, response({ id: reqId, result: noBaseFee }));
        const res = await eth_getBlockByNumber.handle(
            reqContext as unknown as WalletContext,
            'eth_getBlockByNumber',
            ['latest', false],
            reqId
        );
        const result = (res as unknown as { result: Record<string, unknown> }).result;
        expect(result).not.toHaveProperty('baseFeePerGas');
        expect(result.transactions).toEqual([]);
    });

    rpcUnitTest('always empties transactions (privacy), even with detail flag', async ({ reqContext, rpc }) => {
        rpc.registerDelegate(reqId, response({ id: reqId, result: createBlockWithTxHashes() }));
        const res = await eth_getBlockByNumber.handle(
            reqContext as unknown as WalletContext,
            'eth_getBlockByNumber',
            ['latest', true],
            reqId
        );
        expect((res as unknown as { result: { transactions: unknown[] } }).result.transactions).toEqual([]);
    });
});
