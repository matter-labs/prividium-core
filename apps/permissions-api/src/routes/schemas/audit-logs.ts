import { z } from 'zod/v4';
import { SelectAuditLogSchema } from '../../repositories/audit-logs-repository';
import { PaginationQuerySchema } from '../../utils/schemas/fastify-common';

export function auditPaginationQuerySchema(maxItems: number) {
    return PaginationQuerySchema({
        limit: { max: Math.min(1000, maxItems), default: Math.min(50, maxItems) },
        offset: { max: maxItems - 1 }
    });
}

export const OrganizationAuditLogSchema = SelectAuditLogSchema.extend({
    activeTenantId: z.null(),
    activeServiceId: z.null(),
    authSubject: z.null(),
    ipAddress: z.null(),
    userAgent: z.null(),
    actionDetails: z.object({
        resourceType: z.string().optional(),
        resourceId: z.string().optional(),
        operation: z.string().optional(),
        result: z.string().optional(),
        statusCode: z.number().optional(),
        organizationLinkChange: z.enum(['added', 'removed']).optional()
    }),
    operatorBypass: z.boolean()
});

export const ActionTypesResponseSchema = z.object({
    actionTypes: z.array(z.string())
});
