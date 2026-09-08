import blake from 'blakejs';
import type { Hex } from 'viem';

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    const totalSize = arrays.map((bytes) => bytes.length).reduce((a, b) => a + b);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

export function blake2s256(data: Uint8Array): Uint8Array {
    return blake.blake2s(data, undefined, 32);
}

export function areHexEqual(hex1: Hex, hex2: Hex): boolean {
    return hex1.toLowerCase() === hex2.toLowerCase();
}
