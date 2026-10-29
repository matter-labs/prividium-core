import { type Hex, serializeTransaction } from 'viem';
import { privateKeyToAccount, signAuthorization } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { ForbiddenRpcError, WrongArguments } from '#rpc/errors';
import { response } from '#rpc/json-rpc';
import type { AuthorizedRpcContext } from '#rpc/rpc-service';
import { rpcUnitTest } from '#test/rpc/rpc-unit-test-utils';
import { decodeTx, eth_sendRawTransaction } from './eth_sendRawTransaction';

// Deterministic test key (NEVER use for anything but tests).
const PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(PRIVATE_KEY);
const RECIPIENT = '0x0000000000000000000000000000000000000001';
const OTHER_WALLET = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const EOA_RECIPIENT = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';

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

describe('eth_sendRawTransaction native transfer', () => {
    const REQUEST_ID = 1;
    const TX_HASH: Hex = `0x${'ab'.repeat(32)}`;
    const UPSTREAM_RESPONSE = response({ id: REQUEST_ID, result: TX_HASH });

    const sendTransfer = async (reqContext: AuthorizedRpcContext) => {
        const raw = await account.signTransaction({
            type: 'legacy',
            chainId: 297,
            nonce: 3,
            gasPrice: 1n,
            gas: 21000n,
            to: EOA_RECIPIENT,
            value: 1n
        });
        return eth_sendRawTransaction.handle(reqContext, 'eth_sendRawTransaction', [raw], REQUEST_ID);
    };

    rpcUnitTest(
        'refuses a transfer signed by a wallet the caller does not own',
        async ({ reqContext, authorizer, rpc }) => {
            authorizer.setUserAddresses([OTHER_WALLET]);

            const denial = sendTransfer(reqContext);

            await expect(denial).rejects.toThrow(ForbiddenRpcError);
            await expect(denial).rejects.toHaveProperty('ruleId', 'wallet.not_owned_by_user');
            expect(rpc.delegateRegistry).toEqual([]);
        }
    );

    rpcUnitTest('forwards a transfer signed by a wallet the caller owns', async ({ reqContext, authorizer, rpc }) => {
        authorizer.setUserAddresses([account.address]);
        // besu submits through plain eth_sendRawTransaction, so the stubbed hash comes back unchanged.
        rpc.chainType = 'besu';
        rpc.registerDelegate(`${REQUEST_ID}`, UPSTREAM_RESPONSE);

        await expect(sendTransfer(reqContext)).resolves.toEqual(UPSTREAM_RESPONSE);
        expect(rpc.delegateRegistry.map((entry) => entry.method)).toEqual(['eth_sendRawTransaction']);
    });
});
