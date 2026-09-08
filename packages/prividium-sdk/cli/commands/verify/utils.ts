import { readFileSync } from 'node:fs';
import type { Hex } from 'viem';
import { z } from 'zod';

import { hexSchema } from '../utils/schemas.js';

export function parseBlockNumber(str: string): bigint {
    try {
        return BigInt(str);
    } catch {
        throw new Error('Invalid block number provided');
    }
}
const hexRegex = /0x[a-fA-F0-9]+/;

export function intoAddressCodePair(strings: string[]): [Hex, Hex] {
    const [addr, code] = strings.filter((part) => hexRegex.test(part));
    if (addr === undefined || code === undefined) {
        throw new Error('Wrong bytecode format. Only 1 colon is allowed');
    }

    if (addr.length !== 42) {
        throw new Error(`Invalid value. Expected address received: ${addr}`);
    }

    return [addr, code] as [Hex, Hex];
}

export function parseBytecodes(raw: string[]): Record<Hex, Hex> {
    const res: Record<Hex, Hex> = {};
    for (const elem of raw) {
        const parts = elem.split(':').map((part) => part.trim());
        const [addr, code] = intoAddressCodePair(parts);
        res[addr] = code;
    }

    return res;
}

export function loadBytecodes(filePath: string | undefined, raw: string[]): Record<Hex, Hex> {
    if (filePath !== undefined) {
        const data = JSON.parse(readFileSync(filePath).toString());
        return z.record(hexSchema, hexSchema).parse(data);
    }
    return parseBytecodes(raw);
}
