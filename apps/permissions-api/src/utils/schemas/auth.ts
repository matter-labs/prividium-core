import { z } from 'zod/v4';
import { TargetTypes } from '../../db/schema';

export const sessionTypes = z.enum([
    TargetTypes.enum.user,
    TargetTypes.enum.service,
    TargetTypes.enum.tenant,
    'm2m_app',
    'anonymous'
]);
export type SessionType = z.infer<typeof sessionTypes>;

export const currentSessionSchema = z.object({
    type: sessionTypes,
    expiresAt: z.iso.datetime(),
    renewableUntil: z.iso.datetime()
});
