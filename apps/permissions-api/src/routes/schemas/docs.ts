import { z } from 'zod/v4';

export const EstablishSessionBodySchema = z.object({
    token: z.string().min(1).max(512)
});
