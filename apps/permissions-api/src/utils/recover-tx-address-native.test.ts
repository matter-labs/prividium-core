import {
    type Hex,
    parseTransaction,
    recoverTransactionAddress,
    type SerializedTransactionReturnType,
    serializeTransaction
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, signAuthorization } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { recoverTransactionAddressNative } from './recover-tx-address-native';

// Three deterministic test keys (NEVER use these for anything but tests).
const KEYS: Hex[] = [
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
];

// Cross-product of tx envelope flavors that real users send.
async function makeSignedTxs() {
    const accounts = KEYS.map((k) => privateKeyToAccount(k));
    const txs: { label: string; raw: SerializedTransactionReturnType; expected: Hex }[] = [];

    const cast = (sig: Hex): SerializedTransactionReturnType => sig as SerializedTransactionReturnType;

    for (const acct of accounts) {
        // legacy / EIP-155 (chainId 297)
        {
            const sig = await acct.signTransaction({
                type: 'legacy',
                chainId: 297,
                nonce: 0,
                gasPrice: 0n,
                gas: 21000n,
                to: acct.address,
                value: 1n
            });
            txs.push({ label: `legacy/${acct.address}`, raw: cast(sig), expected: acct.address });
        }
        // EIP-2930 (access list)
        {
            const sig = await acct.signTransaction({
                type: 'eip2930',
                chainId: 1,
                nonce: 5,
                gasPrice: 1_000_000_000n,
                gas: 21000n,
                to: acct.address,
                value: 0n,
                accessList: []
            });
            txs.push({ label: `eip2930/${acct.address}`, raw: cast(sig), expected: acct.address });
        }
        // EIP-1559 (most common modern path)
        {
            const sig = await acct.signTransaction({
                type: 'eip1559',
                chainId: 1,
                nonce: 100,
                maxFeePerGas: 30_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                gas: 21000n,
                to: acct.address,
                value: 1_000_000_000_000n,
                data: '0xdeadbeef'
            });
            txs.push({ label: `eip1559/${acct.address}`, raw: cast(sig), expected: acct.address });
        }
    }
    return txs;
}

describe('recoverTransactionAddressNative', () => {
    it('matches viem.recoverTransactionAddress for legacy / 2930 / 1559 envelopes', async () => {
        const txs = await makeSignedTxs();
        for (const { label, raw, expected } of txs) {
            const native = await recoverTransactionAddressNative({ serializedTransaction: raw });
            const reference = await recoverTransactionAddress({ serializedTransaction: raw });
            // Exact (case-sensitive) match - asserts our EIP-55 checksum
            // matches viem's. The downstream `checkContractAccess` paths
            // compare addresses with `areHexEqual` (case-insensitive), but
            // any other consumer would expect a checksummed Address.
            expect(native, `native vs viem (${label})`).toBe(reference);
            expect(native, `native vs signer (${label})`).toBe(expected);
        }
    });

    it('matches viem case-exact (EIP-55 checksum) on a fuzz cross-product', async () => {
        // Fuzz: 60 randomly generated private keys × varied envelope shape ×
        // varied chainId. Compares native output to viem byte-for-byte
        // (including casing) and to the signing account's address (also
        // checksummed). Catches: missing checksumming, leading-zero r/s
        // padding bugs, recoveryId branch mismatches, chainId precision loss,
        // etc.
        const TYPES = ['legacy', 'eip2930', 'eip1559'] as const;
        const CHAIN_IDS = [1, 297, 31337, 11155111, 0x100000000];

        for (let i = 0; i < 60; i++) {
            const acct = privateKeyToAccount(generatePrivateKey());
            const type = TYPES[i % TYPES.length]!;
            const chainId = CHAIN_IDS[i % CHAIN_IDS.length]!;
            const nonce = i;
            const value = i % 5 === 0 ? 0n : BigInt(i) * 10n ** BigInt(i % 18);
            const gas = 21000n + BigInt(i % 7) * 10_000n;
            const data = i % 3 === 0 ? '0x' : (`0x${'ab'.repeat(i % 100)}` as Hex);

            let raw: Hex;
            if (type === 'legacy') {
                raw = await acct.signTransaction({
                    type,
                    chainId,
                    nonce,
                    gasPrice: BigInt(i + 1) * 1_000_000n,
                    gas,
                    to: acct.address,
                    value,
                    data
                });
            } else if (type === 'eip2930') {
                raw = await acct.signTransaction({
                    type,
                    chainId,
                    nonce,
                    gasPrice: BigInt(i + 1) * 1_000_000n,
                    gas,
                    to: acct.address,
                    value,
                    data,
                    accessList:
                        i % 4 === 0
                            ? [
                                  {
                                      address: '0x0000000000000000000000000000000000000001',
                                      storageKeys: [
                                          '0x0000000000000000000000000000000000000000000000000000000000000000'
                                      ]
                                  }
                              ]
                            : []
                });
            } else {
                raw = await acct.signTransaction({
                    type,
                    chainId,
                    nonce,
                    maxFeePerGas: BigInt(i + 1) * 10n * 1_000_000n,
                    maxPriorityFeePerGas: BigInt(i + 1) * 1_000_000n,
                    gas,
                    to: acct.address,
                    value,
                    data
                });
            }

            const native = await recoverTransactionAddressNative({
                serializedTransaction: raw as SerializedTransactionReturnType
            });
            const reference = await recoverTransactionAddress({
                serializedTransaction: raw as SerializedTransactionReturnType
            });
            expect(native, `iter=${i} type=${type} chainId=${chainId} (native vs viem)`).toBe(reference);
            expect(native, `iter=${i} (native vs signer)`).toBe(acct.address);
        }
    });

    it('matches viem on EIP-7702 (type 4) txs with authorizationList', async () => {
        // EIP-7702 envelope is the most recently added tx type and uses a
        // distinct unsigned-payload encoding. Make sure our code handles it
        // (no special-casing of type code in the recovery path is required —
        // we delegate parsing/serialization to viem — but a regression here
        // would be silent without an explicit test).
        const privateKey = generatePrivateKey();
        const acct = privateKeyToAccount(privateKey);
        const auth = await signAuthorization({
            privateKey,
            chainId: 1,
            nonce: 0,
            contractAddress: '0x0000000000000000000000000000000000000001'
        });
        const raw = await acct.signTransaction({
            type: 'eip7702',
            chainId: 1,
            nonce: 1,
            maxFeePerGas: 1_000_000_000n,
            maxPriorityFeePerGas: 1n,
            gas: 100_000n,
            to: acct.address,
            value: 0n,
            authorizationList: [auth]
        });
        const native = await recoverTransactionAddressNative({
            serializedTransaction: raw as SerializedTransactionReturnType
        });
        const reference = await recoverTransactionAddress({
            serializedTransaction: raw as SerializedTransactionReturnType
        });
        expect(native).toBe(reference);
        expect(native).toBe(acct.address);
    });

    it('handles signatures with leading-zero r and s components', async () => {
        // Some (priv-key, msg-hash) combinations produce signatures whose r or
        // s component has leading zeros, which would corner-case naive r/s
        // packing. Loop a few accounts × nonces to give the prng a chance.
        for (const k of KEYS) {
            const acct = privateKeyToAccount(k);
            for (let nonce = 0; nonce < 4; nonce++) {
                const raw = await acct.signTransaction({
                    type: 'eip1559',
                    chainId: 1,
                    nonce,
                    maxFeePerGas: 1n,
                    maxPriorityFeePerGas: 1n,
                    gas: 21000n,
                    to: acct.address,
                    value: 0n
                });
                const native = await recoverTransactionAddressNative({
                    serializedTransaction: raw as SerializedTransactionReturnType
                });
                const reference = await recoverTransactionAddress({
                    serializedTransaction: raw as SerializedTransactionReturnType
                });
                expect(native).toBe(reference);
                expect(native).toBe(acct.address);
            }
        }
    });

    it('parses and round-trips through serializeTransaction without dropping fields', async () => {
        // Sanity check: serialize -> recover -> address; ensure we can also
        // re-serialize the parsed payload without disturbing the recovery.
        const acct = privateKeyToAccount(KEYS[0]!);
        const raw = await acct.signTransaction({
            type: 'eip1559',
            chainId: 297,
            nonce: 42,
            maxFeePerGas: 5n,
            maxPriorityFeePerGas: 1n,
            gas: 21000n,
            to: acct.address,
            value: 7n
        });
        const reSerialized = serializeTransaction(parseTransaction(raw)) as SerializedTransactionReturnType;
        expect(reSerialized).toBe(raw);
        const native = await recoverTransactionAddressNative({ serializedTransaction: reSerialized });
        expect(native).toBe(acct.address);
    });

    it('throws on malformed (unparseable) input', async () => {
        await expect(
            recoverTransactionAddressNative({
                serializedTransaction: '0xdeadbeef' as SerializedTransactionReturnType
            })
        ).rejects.toThrow();
    });

    it('throws when signature components are missing', async () => {
        // Construct a serialized tx whose signature fields have been blanked.
        // viem.parseTransaction tolerates this (returns undefined r/s); our
        // recovery must not silently produce an address.
        const acct = privateKeyToAccount(KEYS[0]!);
        const signed = await acct.signTransaction({
            type: 'eip1559',
            chainId: 1,
            nonce: 0,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            gas: 21000n,
            to: acct.address,
            value: 0n
        });
        const parsed = parseTransaction(signed);
        const {
            r: _r,
            s: _s,
            v: _v,
            yParity: _y,
            ...rest
        } = parsed as typeof parsed & {
            r?: Hex;
            s?: Hex;
            v?: bigint;
            yParity?: number;
        };
        const unsigned = serializeTransaction(rest) as SerializedTransactionReturnType;
        await expect(recoverTransactionAddressNative({ serializedTransaction: unsigned })).rejects.toThrow();
    });
});
