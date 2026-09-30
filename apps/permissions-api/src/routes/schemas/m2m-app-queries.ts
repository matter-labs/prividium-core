import { z } from 'zod/v4';
import { TIMESTAMP_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { RoleSchema } from './roles';

export const CheckUserReadAccessBodySchema = z.object({
    userId: z.string()
});

export const CheckUserReadAccessResponseSchema = z.object({
    authorized: z.boolean()
});

export const M2mAppSelfSchema = z.object({
    id: z.string(),
    name: z.string(),
    ownerOrganizationId: z.string().nullable(),
    roles: RoleSchema.omit(TIMESTAMP_COLUMNS).array()
});
