import type { FastifyRequest } from 'fastify';
import type { DbOrTx, Repositories } from '../db';
import { type ActorType, type AuditActionType, type AuditResourceType, TargetTypes } from '../db/schema';

export type { ActorType };

export interface AuditLogContextData {
    activeUserId: string | null;
    activeTenantId: string | null;
    activeServiceId: string | null;
    /** Organization whose scope this action took place in (null for zone-level actions). */
    activeOrganizationId?: string | null;
    /** Correlation ID that spans multiple services / requests (from x-trace-id header or generated). */
    traceId: string;
    /** Unique ID for this individual HTTP request. */
    requestId: string;
    /** Broad category of the authenticated principal. */
    actorType: ActorType;
    /**
     * Opaque identifier of the credential used to authenticate (session token hash
     * or API key ID).  Null for anonymous requests.
     */
    authSubject: string | null;
    auditContext: {
        ipAddress?: string;
        userAgent?: string;
        [key: string]: unknown;
    };
}

export class AuditLogContext {
    constructor(
        public activeUserId: string | null,
        public readonly activeTenantId: string | null,
        public readonly activeServiceId: string | null,
        public activeOrganizationId: string | null,
        public readonly traceId: string,
        public readonly requestId: string,
        public readonly actorType: ActorType,
        public readonly authSubject: string | null,
        public readonly auditContext: {
            ipAddress?: string;
            userAgent?: string;
            [key: string]: unknown;
        },
        private readonly auditLogsService: AuditLogsService
    ) {}

    async logSecurityEvent(
        actionType: AuditActionType,
        resourceType: AuditResourceType,
        resourceId?: string,
        actionDetails?: Record<string, unknown>,
        tx?: DbOrTx
    ): Promise<void> {
        await this.auditLogsService.logSecurityEvent(actionType, resourceType, resourceId, this, actionDetails, tx);
    }

    /**
     * This is needed because sometimes audit logs are created during login. In these cases after the identity
     * of the user is verified, logs can be produced at their name. The user's organization is set here too,
     * so a login is recorded in that org's audit trail rather than the zone's.
     */
    setActiveUser(userId: string, organizationId?: string | null) {
        if (this.activeUserId !== null) {
            throw new Error('Non anonymous audit context should not change.');
        }

        this.activeUserId = userId;
        if (organizationId !== undefined) {
            this.activeOrganizationId = organizationId;
        }
    }
}

export function buildBaseContextFromRequest(request: FastifyRequest): {
    ipAddress?: string;
    userAgent?: string;
    [key: string]: unknown;
} {
    return {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        method: request.method,
        url: request.url
    };
}

export function resolveActiveOrganizationId(
    request: FastifyRequest,
    userOrganizationId?: string | null
): string | null {
    const orgParam = (request.params as { id?: string } | undefined)?.id ?? null;
    const isOrgScopedRoute = (request.routeOptions?.url ?? '').includes('/organizations/:id');
    return (isOrgScopedRoute ? orgParam : null) ?? userOrganizationId ?? null;
}

export function auditLogContext(request: FastifyRequest, auditLogsService: AuditLogsService): AuditLogContext {
    const auth = request.auth;
    try {
        const user = auth?.type === TargetTypes.enum.user ? auth.currentUser() : null;
        const tenant = auth?.type === TargetTypes.enum.tenant ? auth.currentTenant() : null;
        const service = auth?.type === TargetTypes.enum.service ? auth.currentService() : null;
        const actorType: ActorType = (auth?.type as ActorType | undefined) ?? 'anonymous';
        const authSubject = auth?.isApiKeyAuth ? auth.currentApiKeyId() : (auth?.tokenHash ?? null);

        const activeOrganizationId = resolveActiveOrganizationId(request, user?.organizationId);

        return new AuditLogContext(
            user?.id ?? null,
            tenant?.id ?? null,
            service?.id ?? null,
            activeOrganizationId,
            request.traceId ?? '',
            request.requestId ?? '',
            actorType,
            authSubject,
            buildBaseContextFromRequest(request),
            auditLogsService
        );
    } catch (error) {
        throw new Error(`Failed to extract user context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function fakeAuditLogContextForTests(
    auditLogsService: AuditLogsService,
    params?: {
        ipAddress?: string;
        userAgent?: string;
        traceId?: string;
        requestId?: string;
        actorType?: ActorType;
        authSubject?: string;
        [key: string]: unknown;
    }
): AuditLogContext {
    return new AuditLogContext(
        null,
        null,
        null,
        null,
        params?.traceId ?? 'test-trace-id',
        params?.requestId ?? 'test-request-id',
        params?.actorType ?? 'anonymous',
        params?.authSubject ?? null,
        {
            ipAddress: params?.ipAddress,
            userAgent: params?.userAgent
        },
        auditLogsService
    );
}

export class AuditLogsService {
    constructor(private readonly repos: Repositories) {}

    async logSecurityEvent(
        actionType: AuditActionType,
        resourceType: AuditResourceType,
        resourceId: string | undefined,
        context: AuditLogContextData,
        actionDetails?: Record<string, unknown>,
        tx?: DbOrTx
    ): Promise<void> {
        const repo = tx ? tx.repositories().auditLogs : this.repos.auditLogs;
        await repo.create({
            activeUserId: context.activeUserId,
            activeTenantId: context.activeTenantId,
            activeServiceId: context.activeServiceId,
            activeOrganizationId: context.activeOrganizationId ?? null,
            traceId: context.traceId,
            requestId: context.requestId,
            actorType: context.actorType,
            authSubject: context.authSubject,
            actionType,
            actionDetails: {
                resourceType,
                resourceId,
                ...actionDetails
            },
            ipAddress: context.auditContext.ipAddress,
            userAgent: context.auditContext.userAgent
        });
    }
}
