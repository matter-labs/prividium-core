import { customType } from 'drizzle-orm/pg-core';
import { type Address, type Hex, numberToHex } from 'viem';
import { z } from 'zod/v4';
import { addressSchema } from '../schemas/address';
import { hexSchema } from '../schemas/hex-schema';

// Schema for method selectors (4-byte hex strings)
const methodSelectorSchema = z
    .string()
    .regex(/^0x[a-fA-F0-9]{8}$/, 'Method selector must be a 4-byte hex string starting with 0x');

export const addressColumn = customType<{
    data: Address;
    driverData: Buffer;
}>({
    dataType() {
        return 'bytea';
    },
    toDriver(val) {
        const parsed = addressSchema.parse(val);
        const hex = parsed.slice(2);
        return Buffer.from(hex, 'hex');
    },
    fromDriver(val) {
        if (typeof val === 'string') {
            const str = String(val);
            return addressSchema.parse(str.replace(/^\\x/, '0x'));
        }
        const address = `0x${val.toString('hex')}`;
        return addressSchema.parse(address);
    }
});

export const methodSelectorColumn = customType<{
    data: `0x${string}`;
    driverData: Buffer;
}>({
    dataType() {
        return 'bytea';
    },
    toDriver(val) {
        // '0x' is to reference the special method "receive()".
        if (val === '0x') {
            return Buffer.alloc(0);
        }
        const parsed = methodSelectorSchema.parse(val);
        const hex = parsed.slice(2);
        return Buffer.from(hex, 'hex');
    },
    fromDriver(val) {
        // '0x' is to reference the special method "receive()".
        if (val.byteLength === 0) {
            return '0x';
        }
        const methodSelector = `0x${val.toString('hex')}`;
        // Don't validate on read to allow fixing malformed data
        // Validation happens on write (toDriver)
        return methodSelector as `0x${string}`;
    }
});

export const hexBytes = {
    dataType() {
        return 'bytea';
    },
    toDriver(val: Hex) {
        if (val === '0x' || val === '0x0') {
            return Buffer.alloc(0);
        }

        const parsed = hexSchema.parse(val);
        let hex = parsed.slice(2);

        // Fix odd length hex strings by padding with leading zero
        if (hex.length % 2 !== 0) {
            hex = `0${hex}`;
        }

        return Buffer.from(hex, 'hex');
    },
    fromDriver(val: Buffer): Hex {
        if (val.byteLength === 0) {
            return '0x';
        }

        return `0x${val.toString('hex')}`;
    }
};

export const hexBytesColumn = customType<{
    data: Hex;
    driverData: Buffer;
}>(hexBytes);

export const uint256 = {
    dataType() {
        return `numeric(78,0)`; // max required precision for storing uint256
    },
    toDriver(val: bigint | number | string | null) {
        if (val === null || val === undefined) return null;
        const b = typeof val === 'bigint' ? val : BigInt(val);
        return b.toString(); // driver expects numeric as string
    },
    fromDriver(val: string | null) {
        if (val === null || val === undefined) return null;
        return BigInt(val);
    }
};

export const uint256Column = customType<{
    data: bigint | null;
    driverData: string | null;
}>(uint256);

/**
 * Stores a nonneg integer as Postgres `bigint` (signed 64-bit, max ~9.2e18) but
 * exposes it to the app as a viem `Hex` quantity. Use this when a value can grow
 * past `Number.MAX_SAFE_INTEGER` and we want the canonical JSON-RPC wire form.
 */
export const hexBigInt = {
    dataType() {
        return 'bigint';
    },
    toDriver(val: Hex): string {
        const parsed = hexSchema.parse(val);
        const n = parsed === '0x' ? 0n : BigInt(parsed);
        if (n < 0n) {
            throw new Error(`hexBigInt cannot store negative values: ${val}`);
        }
        return n.toString();
    },
    fromDriver(val: string): Hex {
        return numberToHex(BigInt(val));
    }
};

export const hexBigIntColumn = customType<{
    data: Hex;
    driverData: string;
}>(hexBigInt);
