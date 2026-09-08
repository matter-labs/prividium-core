import z from 'zod/v4';
import { addressSchema } from './address';
import { hexSchema } from './hex-schema';

/**
 * ERC-4337 UserOperation schema.
 */
export const userOperationSchema = z.object({
    sender: addressSchema,
    nonce: hexSchema,
    initCode: hexSchema.optional(),
    callData: hexSchema,
    callGasLimit: hexSchema,
    verificationGasLimit: hexSchema,
    preVerificationGas: hexSchema,
    maxFeePerGas: hexSchema,
    maxPriorityFeePerGas: hexSchema,
    paymasterAndData: hexSchema.optional(),
    signature: hexSchema
});

export type UserOperation = z.infer<typeof userOperationSchema>;
