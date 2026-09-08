import { z } from 'zod';

export const profileSchema = z.object({
    id: z.string(),
    displayName: z.string(),
    roles: z.array(z.object({ roleName: z.string() })),
    wallets: z.array(
        z.object({
            walletAddress: z.string()
        })
    )
});

export type DoctorProfileSchema = typeof profileSchema;
