import { z } from 'zod/v4';
import { FaucetClaimStatus } from '../../db/schema';
import { addressSchema } from '../../utils/schemas/address';
import { hexSchema } from '../../utils/schemas/hex-schema';

export const ClaimRequestSchema = z.object({
    walletAddress: addressSchema
});

export const ClaimSuccessSchema = z.object({
    txHash: hexSchema,
    amountWei: z.coerce.string(),
    nextEligibleAt: z.iso.datetime()
});

export const FaucetStatusSchema = z.object({
    nextEligibleAt: z.iso.datetime().nullable(),
    lastSuccess: z
        .object({
            createdAt: z.iso.datetime(),
            walletAddress: addressSchema,
            txHash: hexSchema.nullable()
        })
        .nullable()
});

export const FaucetClaimSchema = z.object({
    id: z.string(),
    userId: z.string(),
    walletAddress: addressSchema,
    amountWei: z.coerce.string(),
    txHash: hexSchema.nullable(),
    status: FaucetClaimStatus,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
});

export const AdminFaucetStatusSchema = z.object({
    operatorAddress: addressSchema,
    // null when the upstream RPC is unreachable
    operatorBalanceWei: z.coerce.string().nullable(),
    last24hSuccessWei: z.coerce.string(),
    config: z.object({
        claimAmountWei: z.coerce.string(),
        cooldownSeconds: z.number().int(),
        maxDailySpendWei: z.coerce.string()
    })
});
