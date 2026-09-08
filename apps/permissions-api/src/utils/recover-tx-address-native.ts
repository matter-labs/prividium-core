import { createRequire } from 'node:module';
import {
    bytesToHex,
    getAddress,
    type Hex,
    hexToBytes,
    keccak256,
    parseTransaction,
    type SerializedTransactionReturnType,
    serializeTransaction
} from 'viem';

// Pull the native binding directly. The umbrella `secp256k1` module silently
// falls back to a pure-JS `elliptic` implementation if the native addon fails
// to load — and `elliptic <= 6.6.1` has an open advisory (GHSA-848j-6mx2-7j84)
// with no available patch. Importing the bindings sub-path makes a missing
// native build a hard error at startup instead of a silent crypto-impl
// downgrade at request time.
//
// `@types/secp256k1` only declares the umbrella module, so we go through
// `createRequire` and cast to that same shape — runtime API is identical
// (both modules share the same lib/index.js wrapper around the addon).
const require = createRequire(import.meta.url);
const secp256k1 = require('secp256k1/bindings') as typeof import('secp256k1');

/**
 * Drop-in replacement for viem's `recoverTransactionAddress` that uses the
 * native libsecp256k1 binding (`secp256k1` npm package) instead of the
 * pure-JavaScript implementation in `@noble/curves`.
 *
 * Profiling showed that `@noble/curves` ECDSA recovery via viem accounted
 * for ~33% of permissions-api CPU under sustained `eth_sendRawTransaction`
 * load. The native binding does the same operation 10-50x faster, so this
 * lifts the per-CPU TPS ceiling without changing any behavior.
 *
 * Equivalence with viem (verified against viem 2.44.1):
 *   1. `parseTransaction(raw)` - identical, we delegate to viem.
 *   2. Strip `r, s, v, yParity, sidecars` and re-serialize the unsigned
 *      payload via viem's `serializeTransaction`. Matches viem's
 *      `recoverTransactionAddress` exactly (utils/signature/
 *      recoverTransactionAddress.js:14-21).
 *   3. `keccak256` of the unsigned payload - identical hash function.
 *   4. Recovery id: viem's `recoverPublicKey` reads `Number(yParity ?? v)`
 *      then maps via `toRecoveryBit` (0/1/27/28 -> 0/1). After
 *      `parseTransaction`, `yParity` is always set for any signed tx
 *      (parseTransaction.js:307 for legacy, :346 for typed envelopes via
 *      `parseEIP155Signature`), so we read `yParity` directly. The v-only
 *      branch is unreachable from parsed input and intentionally omitted.
 *   5. Recover -> uncompressed pubkey -> `keccak(pub[1:])[-20:]` ->
 *      `getAddress` (EIP-55 checksum). Matches viem's `publicKeyToAddress`
 *      / `checksumAddress` byte-for-byte (including casing).
 *
 * Equivalence is also asserted by the fuzz tests next to this file
 * (legacy / EIP-2930 / EIP-1559 / EIP-7702, varied chainIds, leading-zero
 * r/s) which compare native output to viem case-exact.
 */
export async function recoverTransactionAddressNative({
    serializedTransaction
}: {
    serializedTransaction: SerializedTransactionReturnType;
}): Promise<Hex> {
    const tx = parseTransaction(serializedTransaction);

    // Strip signature + EIP-4844 sidecars and re-serialize unsigned tx to get
    // the message hash viem hashes. The set of fields stripped here mirrors
    // viem's `recoverTransactionAddress` exactly.
    const {
        r,
        s,
        v: _v,
        yParity,
        sidecars: _sidecars,
        ...txWithoutSig
    } = tx as typeof tx & {
        r?: Hex;
        s?: Hex;
        v?: bigint;
        yParity?: number;
        sidecars?: unknown;
    };
    if (r === undefined || s === undefined) {
        throw new Error('signed transaction is missing r/s components');
    }
    if (yParity !== 0 && yParity !== 1) {
        // viem's parseTransaction always populates yParity (0 or 1) for any
        // signed tx that has r/s, so reaching this line means viem couldn't
        // parse the signature - we refuse rather than silently recovering
        // from a bogus recid.
        throw new Error(`signed transaction is missing or has invalid yParity: ${yParity}`);
    }

    const unsigned = serializeTransaction(txWithoutSig);
    const hash = hexToBytes(keccak256(unsigned));

    // Concatenate r || s into a 64-byte compact signature.
    const sig = new Uint8Array(64);
    sig.set(hexToFixedBytes(r, 32), 0);
    sig.set(hexToFixedBytes(s, 32), 32);

    // Uncompressed pubkey: 65 bytes (0x04 prefix || X || Y).
    const pub = secp256k1.ecdsaRecover(sig, yParity, hash, false);

    // Address = last 20 bytes of keccak(pubkey without the 0x04 prefix).
    // `getAddress` applies the EIP-55 checksum so output matches viem's
    // `recoverTransactionAddress` byte-for-byte (including casing).
    const pubHash = hexToBytes(keccak256(pub.slice(1)));
    return getAddress(bytesToHex(pubHash.slice(-20)));
}

function hexToFixedBytes(hex: Hex, byteLen: number): Uint8Array {
    let h = hex.slice(2);
    if (h.length > byteLen * 2) {
        throw new Error(`hex value too long: ${hex.length} > ${byteLen * 2}`);
    }
    if (h.length < byteLen * 2) {
        h = h.padStart(byteLen * 2, '0');
    }
    return hexToBytes(`0x${h}`);
}
