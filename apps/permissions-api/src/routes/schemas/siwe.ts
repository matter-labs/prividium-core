import { z } from 'zod/v4';
import { hexSchema } from '../../utils/schemas/hex-schema';

const baseCreateLoginSiweMsgSchema = z.object({
    address: hexSchema
});

export const CreateUserLoginSiweMsgSchema = baseCreateLoginSiweMsgSchema.extend({
    domain: z.string().optional(),
    organizationId: z.string().max(64).optional()
});

export const CreateTenantLoginSiweMsgSchema = baseCreateLoginSiweMsgSchema;

export const CreateServiceLoginSiweMsgSchema = baseCreateLoginSiweMsgSchema;

export const SiweMsgSchema = z.object({
    nonce: z.string(),
    msg: z.string(),
    nonceToken: z.string()
});
