import { z } from 'zod/v4';

export const hexSchema = z.templateLiteral(['0x', z.string().regex(/^[0-9a-fA-F]*$/)]);

/**
 * U256 wire format: `0x`-prefixed hex with at least one digit (no leading
 * zeros). Used by the policy listener routes (`/admit`, `/judge`) for the
 * `value` field, which the sequencer encodes as a tightly-packed U256.
 *
 * Note: the regex only enforces "valid hex"; the U256 upper bound is
 * enforced downstream when callers parse the string with `BigInt(...)`.
 */
export const u256HexSchema = z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, 'value must be 0x-prefixed hex with at least one digit');

export const hexSizedSchema = (bytes: number) =>
    z.templateLiteral(
        ['0x', z.string().regex(new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`))],
        `Must be a valid hex string starting with 0x and containing exactly ${bytes} bytes`
    );

/**
 * ABI method selector: exactly 4 bytes (8 hex chars) with a 0x-prefix.
 */
export const methodSelectorSchema = z.union([hexSizedSchema(4), z.literal('0x')]);
export type MethodSelector = z.infer<typeof methodSelectorSchema>;
