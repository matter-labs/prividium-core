import { z } from 'zod/v4';

export const CheckUserReadAccessBodySchema = z.object({
    userId: z.string()
});

export const CheckUserReadAccessResponseSchema = z.object({
    authorized: z.boolean()
});
