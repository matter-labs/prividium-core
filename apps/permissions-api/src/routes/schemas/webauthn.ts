import { z } from 'zod/v4';

export const CredentialSchema = z.object({
    id: z.string(),
    credentialId: z.string(),
    deviceName: z.string().nullable(),
    lastUsedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime()
});
