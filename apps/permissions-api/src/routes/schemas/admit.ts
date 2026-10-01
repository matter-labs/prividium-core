import { OVERLAY_MOMENTS } from '@repo/api-kit';
import { z } from 'zod/v4';
import { addressSchema } from '../../utils/schemas/address';
import { hexSchema, hexSizedSchema, u256HexSchema } from '../../utils/schemas/hex-schema';

// to is omitted (not null) for contract-creation txs; value is a 0x-hex U256; calldata is 0x-hex ("0x" when empty)
export const AdmitRequestSchema = z.object({
    protocolVersion: z.string().min(1),
    from: addressSchema,
    to: addressSchema.optional(),
    value: u256HexSchema,
    calldata: hexSchema,
    gasLimit: z.number().int().nonnegative(),
    accessType: z.enum(['read', 'write']),
    // Optional: older sequencers omit it, and a simulation carries none.
    txHash: hexSizedSchema(32).optional(),
    moment: z.enum(OVERLAY_MOMENTS).optional()
});

export const AdmitResponseSchema = z.object({
    allow: z.boolean(),
    ruleId: z.string().optional(),
    reason: z.string().optional(),
    protocolVersion: z.string()
});
