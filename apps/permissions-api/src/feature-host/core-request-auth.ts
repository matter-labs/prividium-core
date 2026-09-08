import type { Permission } from '@repo/access-control';
import type {
    AuthenticatedPrincipal,
    CallerKind,
    FeatureAuditContext,
    FeatureAuditEventDetails,
    OrgSurfaceOptions,
    RequestAuthGuards,
    RequestHook
} from '@repo/api-kit';
import { ForbiddenError } from '@repo/api-kit';
import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { Address } from 'viem';
import type { AuditResourceType } from '../db/schema';
import { requireOrgAdmin, requireOrgAdminOn } from '../middleware/require-org-admin';
import {
    requireM2mAppOrgAssociation,
    requireOrgMemberForUserCaller,
    requireOrgPermissionForM2mCaller
} from '../middleware/require-org-membership';
import type { SessionsAuthValidator } from '../middleware/sessions-auth';
import { userHasWallet } from '../utils/user-wallets';

/**
 * Names the subset of the core's existing guards a feature may ask for, so it never
 * reaches for `request.auth` or a middleware path of its own.
 */
export class CoreRequestAuthGuards implements RequestAuthGuards {
    private sessionAuthValidator: SessionsAuthValidator;

    constructor({ sessionAuthValidator }: { sessionAuthValidator: SessionsAuthValidator }) {
        this.sessionAuthValidator = sessionAuthValidator;
    }

    authenticate(kinds: readonly [CallerKind, ...CallerKind[]]): RequestHook {
        const [first, ...rest] = kinds;
        return this.sessionAuthValidator.buildHook({
            targets: [{ type: first }, ...rest.map((kind) => ({ type: kind }))]
        });
    }

    adminSurface(): RequestHook {
        return this.sessionAuthValidator.buildHook((request) => ({
            targets: [
                { type: 'user', requiredSystemPermissions: [request.method === 'GET' ? 'admin_read' : 'admin_write'] }
            ]
        }));
    }

    orgAdminSurface(opts: OrgSurfaceOptions = {}): readonly RequestHook[] {
        return [opts.orgIdParam === undefined ? requireOrgAdmin : requireOrgAdminOn(opts.orgIdParam)];
    }

    orgMemberSurface({ m2mPermission }: { m2mPermission: Permission }): readonly RequestHook[] {
        return [
            requireOrgMemberForUserCaller,
            requireM2mAppOrgAssociation,
            requireOrgPermissionForM2mCaller(m2mPermission)
        ];
    }

    /** From the session, never the body; `authenticate` has refused every other kind. */
    principalOf(request: FastifyRequest): AuthenticatedPrincipal {
        if (request.auth.type === 'm2m_app') {
            const app = request.auth.currentM2mApp();
            return { kind: 'm2m_app', id: app.id, roleIds: app.roles.map((role) => role.id) };
        }

        const user = request.auth.currentUser();
        return { kind: 'user', id: user.id, roleIds: user.roles.map((role) => role.id) };
    }

    callerOwnsWallet(request: FastifyRequest, address: Address): boolean {
        return request.auth.type === 'user' && userHasWallet(request.auth.currentUser(), address);
    }

    /** Fail-closed, but logs anything that is not a `ForbiddenError`: a database blip
     * would otherwise silently look like a refusal. */
    async isOrgAdmin(request: FastifyRequest): Promise<boolean> {
        if (request.auth.type !== 'user') {
            return false;
        }
        try {
            await requireOrgAdmin(request);
            return true;
        } catch (error) {
            if (!(error instanceof ForbiddenError)) {
                request.log.error({ err: error }, 'Could not determine organization-admin status; denying');
            }
            return false;
        }
    }
}

/** Cast in one place: the core types this on its own unions, a feature's are its own. */
export function featureAuditContextOf(request: FastifyRequest): FeatureAuditContext {
    return {
        logSecurityEvent: request.auditContext.logSecurityEvent.bind(
            request.auditContext
        ) as FeatureAuditContext['logSecurityEvent'],
        annotate: (details: FeatureAuditEventDetails) => {
            const existing = request.auditEventDetails;
            request.auditEventDetails = {
                resourceType: (details.resourceType as AuditResourceType | undefined) ?? existing?.resourceType,
                resourceId: details.resourceId ?? existing?.resourceId,
                actionDetails: { ...existing?.actionDetails, ...details.actionDetails }
            };
        }
    };
}

/** Absent only where the audit-context middleware did not run, which is a wiring
 * error rather than a state to paper over. */
export function requestAuditClient(request: FastifyRequest): PoolClient {
    const client = request.auditDbClient;
    if (client === undefined) {
        throw new Error('No audit-scoped connection on this request: the audit-context middleware did not run');
    }
    return client;
}
