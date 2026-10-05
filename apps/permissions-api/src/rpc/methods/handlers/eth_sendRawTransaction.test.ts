import { type Hex, serializeTransaction } from 'viem';
import { privateKeyToAccount, signAuthorization } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { WrongArguments } from '../../errors';
import { decodeTx } from './eth_sendRawTransaction';

// Deterministic test key (NEVER use for anything but tests).
const PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(PRIVATE_KEY);
const RECIPIENT = '0x0000000000000000000000000000000000000001';

describe('decodeTx', () => {
    it.each([
        ['legacy', { type: 'legacy', chainId: 297, nonce: 3, gasPrice: 1n, gas: 21000n, to: RECIPIENT, value: 1n }],
        [
            'eip2930',
            {
                type: 'eip2930',
                chainId: 1,
                nonce: 3,
                gasPrice: 1n,
                gas: 21000n,
                to: RECIPIENT,
                value: 1n,
                accessList: []
            }
        ],
        [
            'eip1559',
            {
                type: 'eip1559',
                chainId: 1,
                nonce: 3,
                maxFeePerGas: 2n,
                maxPriorityFeePerGas: 1n,
                gas: 21000n,
                to: RECIPIENT,
                value: 1n
            }
        ]
    ] as const)('decodes a %s transaction', async (_type, request) => {
        const raw = await account.signTransaction(request);

        await expect(decodeTx(raw)).resolves.toEqual({
            from: account.address,
            to: RECIPIENT,
            nonce: 3,
            data: '0x',
            value: 1n
        });
    });

    it('rejects an eip7702 transaction shaped like a bare transfer to an EOA', async () => {
        const auth = await signAuthorization({
            privateKey: PRIVATE_KEY,
            chainId: 1,
            nonce: 1,
            contractAddress: RECIPIENT
        });
        const raw = await account.signTransaction({
            type: 'eip7702',
            chainId: 1,
            nonce: 0,
            maxFeePerGas: 2n,
            maxPriorityFeePerGas: 1n,
            gas: 100_000n,
            to: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
            value: 1n,
            authorizationList: [auth]
        });

        const result = decodeTx(raw);
        await expect(result).rejects.toBeInstanceOf(WrongArguments);
        await expect(result).rejects.toThrow('Unsupported eip7702 transaction');
    });

    it('rejects an eip4844 transaction', async () => {
        // The type check runs before signature recovery, so a placeholder signature is enough.
        const raw = serializeTransaction(
            {
                type: 'eip4844',
                chainId: 1,
                nonce: 0,
                maxFeePerGas: 2n,
                maxPriorityFeePerGas: 1n,
                maxFeePerBlobGas: 1n,
                gas: 21000n,
                to: RECIPIENT,
                value: 0n,
                blobVersionedHashes: [`0x01${'00'.repeat(31)}`]
            },
            { r: `0x${'1'.padStart(64, '0')}`, s: `0x${'1'.padStart(64, '0')}`, yParity: 0 }
        );

        const result = decodeTx(raw);
        await expect(result).rejects.toBeInstanceOf(WrongArguments);
        await expect(result).rejects.toThrow('Unsupported eip4844 transaction');
    });
});
