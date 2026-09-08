import type { Permission } from '@repo/access-control';
import type { FastifyRequest } from 'fastify';
import type { Address } from 'viem';

/**
 * Implemented only by the core. Feature routes name no core middleware or
 * `request.auth`, so they survive moving behind the gateway unchanged.
 */

/** Caller kinds a feature surface may admit. Anonymous is never one of them. */
export type CallerKind = 'user' | 'm2m_app';

export type AuthenticatedPrincipal = {
    kind: CallerKind;
    id: string;
    roleIds: readonly string[];
};

/** A Fastify hook. Declared by shape so a feature registers it without naming the core. */
export type RequestHook = (request: FastifyRequest) => Promise<void>;

export type OrgSurfaceOptions = {
    /** Named, not assumed: a differently-named param would answer 500 instead of 403. */
    orgIdParam?: string;
};

export interface RequestAuthGuards {
    authenticate(kinds: readonly [CallerKind, ...CallerKind[]]): RequestHook;

    /** Zone operators: `admin_read` for reads, `admin_write` for everything else. */
    adminSurface(): RequestHook;

    orgAdminSurface(opts?: OrgSurfaceOptions): readonly RequestHook[];

    /**
     * Members of the organization at `:id`, operators, and machines holding
     * `m2mPermission` -- association alone would let an integration act elsewhere.
     */
    orgMemberSurface(opts: { m2mPermission: Permission }): readonly RequestHook[];

    principalOf(request: FastifyRequest): AuthenticatedPrincipal;

    isOrgAdmin(request: FastifyRequest): Promise<boolean>;

    /**
     * An unowned address recorded as the caller's pre-authorizes its real owner's
     * operations. False for a machine caller, which owns no wallet.
     */
    callerOwnsWallet(request: FastifyRequest, address: Address): boolean;
}

/** What a route-level `audit_action` event records about the resource it touched. */
export type FeatureAuditEventDetails = {
    resourceType?: string;
    resourceId?: string;
    actionDetails?: Record<string, unknown>;
};

/** Route-level actions are declared with `config: { audit_action }`, not raised here. */
export interface FeatureAuditContext {
    /** For an event a feature raises *conditionally*, outside the route-level one. */
    logSecurityEvent(
        action: string,
        entityType: string,
        entityId: string,
        details?: Record<string, unknown>
    ): Promise<void>;

    /** Merges into the route-level event; later calls override earlier keys. */
    annotate(details: FeatureAuditEventDetails): void;
}
