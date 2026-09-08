import { it as baseIt } from '@vitest/runner';
import { describe, expect, vi } from 'vitest';
import { ZERO_LOGS_BLOOM } from '../../../../src/rpc/constants';
import { eth_getTransactionReceipt } from '../../../../src/rpc/methods/wallet-rules/eth_getTransactionReceipt';
import type { WalletContext } from '../../../../src/rpc/rpc-service';
import { TestExternalRpc } from '../../test-external-rpc';

type WalletFixture = {
    rpc: TestExternalRpc;
    context: WalletContext;
    setTxHash: (hash: string | null) => void;
};

const it = baseIt.extend<WalletFixture>({
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture
    rpc: async ({}, use) => {
        await use(new TestExternalRpc());
    },
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture
    setTxHash: async ({}, use) => {
        await use((_h: string | null) => {});
    },
    context: async ({ rpc }, use) => {
        let txHash: string | null = null;
        const ctx = {
            targetRpc: rpc,
            bundlerRpc: null,
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            walletAuthorizer: {
                getTxHash: () => Promise.resolve(txHash)
            },
            _setTxHash: (h: string | null) => {
                txHash = h;
            }
        } as unknown as WalletContext & { _setTxHash: (h: string | null) => void };
        await use(ctx);
    }
});

const NON_ZERO_BLOOM =
    '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000010080000800000000000000000';

describe('wallet-rules: eth_getTransactionReceipt', () => {
    const method = eth_getTransactionReceipt;
    const txHash = '0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb';
    const reqId = 'req-1';

    it('zeroes logsBloom in receipt when tx hash matches allowance', async ({ rpc, context }) => {
        (context as unknown as { _setTxHash: (h: string) => void })._setTxHash(txHash);

        rpc.registerDelegate(reqId, {
            jsonrpc: '2.0',
            id: reqId,
            result: {
                transactionHash: txHash,
                from: '0x0000000000000000000000000000000000000001',
                to: '0x0000000000000000000000000000000000000002',
                logsBloom: NON_ZERO_BLOOM,
                logs: []
            }
        });

        const res = await method.handle(context, 'eth_getTransactionReceipt', [txHash], reqId);

        expect(res).toMatchObject({
            id: reqId,
            result: {
                transactionHash: txHash,
                logsBloom: ZERO_LOGS_BLOOM
            }
        });

        // Verify the original bloom was non-zero (sanity check)
        expect(NON_ZERO_BLOOM).not.toBe(ZERO_LOGS_BLOOM);
    });

    it('returns null when tx hash does not match allowance', async ({ context }) => {
        (context as unknown as { _setTxHash: (h: string) => void })._setTxHash('0xdifferenthash');

        const res = await method.handle(context, 'eth_getTransactionReceipt', [txHash], reqId);

        expect(res).toMatchObject({
            id: reqId,
            result: null
        });
    });
});
