import { z } from 'zod/v4';

export const ActionTypesResponseSchema = z.object({
    actionTypes: z.array(z.string())
});
