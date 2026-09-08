import { z } from 'zod/v4';

export const ServiceActionBodySchema = z.object({
    userId: z.string()
});

export const ServiceActionResponseSchema = z.object({
    authorized: z.boolean()
});
