import { z } from 'zod/v4';
import { addressSchema } from '../../utils/schemas/address';
import { hexSchema } from '../../utils/schemas/hex-schema';

export const InitiateWalletAssociationSchema = z.object({
    walletAddress: addressSchema,
    domain: z.string()
});

export const AssociateWalletSchema = z.object({
    walletAddress: addressSchema,
    message: z.string(),
    signature: hexSchema,
    nonceToken: z.string()
});

export const WalletListResponseSchema = z.object({
    wallets: z.array(addressSchema)
});

export const SiweMessageResponseSchema = z.object({
    message: z.string(),
    nonce: z.string(),
    nonceToken: z.string()
});

export const InvalidateResponseSchema = z.object({
    newWalletToken: z.base64url(),
    message: z.string()
});

export const PersonalRpcTokenResponseSchema = z.object({
    token: z.base64url()
});

export const EnableWalletRequestSchema = z.object({
    calldata: hexSchema,
    nonce: z.number().int().nonnegative(),
    walletAddress: addressSchema,
    contractAddress: addressSchema
});

export const EnableWalletResponseSchema = z.object({
    message: z.string(),
    activeUntil: z.string()
});

export const TransactionAuthorizationRequestSchema = z.object({
    walletAddress: addressSchema,
    nonce: z.number().int().nonnegative(),
    toAddress: addressSchema.nullable(),
    calldata: hexSchema.optional(),
    value: z.string().transform(BigInt).optional()
});

export const TransactionAuthorizationResponseSchema = z.object({
    message: z.string(),
    activeUntil: z.string()
});

export const UpdateTransactionHashRequestSchema = z.object({
    rawTx: hexSchema
});

export const UpdateTransactionHashResponseSchema = z.object({
    hash: hexSchema
});
