import { z } from 'zod/v4';

export const AuthorizedSchema = z.object({
    authorized: z.boolean()
});
