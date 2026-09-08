import type { Hex } from 'viem';

export function hexListIncludes(list: Hex[], toCheck: Hex): boolean {
    return list.some((elem) => elem.toLowerCase() === toCheck.toLowerCase());
}

export function areHexEqual(a: Hex, b: Hex): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

export function hexToBigIntKey(value: Hex): bigint {
    return BigInt(value.toLowerCase());
}
