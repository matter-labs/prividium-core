import { pino } from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, test, vi } from 'vitest';
import { eth_sendRawTransaction } from '../../../../src/rpc/methods/wallet-rules/eth_sendRawTransaction';
import type { WalletAuthorizer } from '../../../../src/rpc/permissions/wallet-authorizer';
import type { WalletContext } from '../../../../src/rpc/rpc-service';
import { TestExternalRpc } from '../../test-external-rpc';

const SIGNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const HASH = '0x1111111111111111111111111111111111111111111111111111111111111111';

describe('wallet-rules eth_sendRawTransaction on a besu target', () => {
    test('a plain-hash success stores the tx hash for receipt polling', async () => {
        const targetRpc = new TestExternalRpc();
        targetRpc.chainType = 'besu';
        targetRpc.registerDelegate('req-1', { jsonrpc: '2.0', id: 'req-1', result: HASH });

        const updateTransactionHash = vi.fn(async () => {});
        const walletAuthorizer = {
            checkTransactionAllowed: vi.fn(async () => ({ authorized: true })),
            updateTransactionHash,
            userId: 'user-1'
        } as unknown as WalletAuthorizer;

        const context: WalletContext = {
            targetRpc,
            bundlerRpc: null,
            logger: pino({ level: 'silent' }),
            deployment: null,
            walletAuthorizer
        };

        const account = privateKeyToAccount(SIGNER_KEY);
        const rawTx = await account.signTransaction({
            chainId: 1,
            nonce: 0,
            to: '0x000000000000000000000000000000000000dead',
            value: 1n,
            gas: 21000n,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n
        });

        const result = await eth_sendRawTransaction.handle(context, 'eth_sendRawTransaction', [rawTx], 'req-1');

        expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: HASH });
        expect(updateTransactionHash).toHaveBeenCalledWith(rawTx);
    });
});
