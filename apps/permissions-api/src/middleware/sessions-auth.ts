import '@fastify/cookie';
import { ACTOR_TYPES, hasZoneSystemPermission, type Permission } from '@repo/access-control';
import type { FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import type { Repositories } from '../db';
import { TargetTypes } from '../db/schema';
import type { Session } from '../repositories/sessions-repository';
import type { UserWithRoles } from '../repositories/users-repository';
import {
    type AuditLogContextData,
    AuditLogsService,
    resolveActiveOrganizationId
} from '../services/audit-logs-service';
import { SessionService } from '../services/session-service';
import { DOCS_SESSION_COOKIE_NAME, isDocsRequest } from '../utils/docs-session';
import { ForbiddenError, UnauthorizedError } from '../utils/error-types';
import type { PinoLogger } from '../utils/logger';
import { belongsToDeletedOrganization } from '../utils/organization-membership';
import { sessionTypes } from '../utils/schemas/auth';
import { API_KEY_HEADER, type ApiKeyAuthValidator, type ApiKeyTarget } from './api-key-auth';
import { AuthData } from './auth-data';

declare module 'fastify' {
    interface FastifyRequest {
        auth: AuthData;
    }
}

type TargetConfig =
    | {
          type: typeof sessionTypes.enum.user;
          requiredRoles?: string[];
          requiredSystemPermissions?: Permission[];
      }
    | {
          type: typeof sessionTypes.enum.tenant;
      }
    | {
          type: typeof sessionTypes.enum.service;
      }
    | {
          type: typeof sessionTypes.enum.m2m_app;
      }
    | {
          type: typeof sessionTypes.enum.anonymous;
      };

type BuildHookOpts = {
    targets: [TargetConfig, ...TargetConfig[]]; // At least one target required
};

type BuildHookOptsResolver = (request: FastifyRequest) => BuildHookOpts | Promise<BuildHookOpts>;
type BuildHookInput = BuildHookOpts | BuildHookOptsResolver;

export class SessionsAuthValidator {
    private logger: PinoLogger;
    private repos: Repositories;
    private apiKeyAuthValidator: ApiKeyAuthValidator;

    constructor({
        logger,
        repos,
        apiKeyAuthValidator
    }: {
        logger: PinoLogger;
        repos: Repositories;
        apiKeyAuthValidator: ApiKeyAuthValidator;
    }) {
        this.logger = logger;
        this.repos = repos;
        this.apiKeyAuthValidator = apiKeyAuthValidator;
    }

    buildHook(opts: BuildHookInput) {
        return async (request: FastifyRequest) => {
            const resolvedOpts = typeof opts === 'function' ? await opts(request) : opts;
            request.auth = await this.extractAuthData(request, resolvedOpts);
        };
    }

    buildSyncHook(opts: BuildHookInput) {
        const hook = this.buildHook(opts);
        return (req: FastifyRequest, _res: unknown, done: HookHandlerDoneFunction) => {
            hook(req).then(
                () => done(),
                (e) => done(e)
            );
        };
    }

    async extractAuthData(request: FastifyRequest, opts: BuildHookOpts): Promise<AuthData> {
        if (request.headers[API_KEY_HEADER]) {
            const apiKeyTargets = opts.targets
                .map((target) => target.type)
                .filter((target): target is ApiKeyTarget => target === 'tenant' || target === 'm2m_app');

            if (apiKeyTargets.length === 0) {
                this.logger.debug(
                    { attemptedTypes: opts.targets.map((target) => target.type) },
                    'API key auth is not allowed for these targets'
                );
                throw new UnauthorizedError('Invalid session');
            }

            return this.apiKeyAuthValidator.extractAuthDataForTargets(request, apiKeyTargets);
        }

        const { user, tenant, service, session, tokenHash } = await this.extractSession(request);

        // Try each target in order
        for (const targetConfig of opts.targets) {
            if (targetConfig.type === 'user' && user && session && tokenHash) {
                return await this.handleUserAuth(
                    request,
                    user,
                    targetConfig.requiredRoles ?? [],
                    targetConfig.requiredSystemPermissions ?? [],
                    session,
                    tokenHash
                );
            }

            if (targetConfig.type === 'tenant' && tenant && session && tokenHash) {
                return new AuthData({
                    tenant,
                    targetType: TargetTypes.enum.tenant,
                    sessionTokenHash: tokenHash,
                    expiresAt: session.expiresAt,
                    renewableUntil: session.renewableUntil ?? session.expiresAt,
                    authMethod: 'session'
                });
            }

            if (targetConfig.type === TargetTypes.enum.service && service && session && tokenHash) {
                return new AuthData({
                    service,
                    targetType: TargetTypes.enum.service,
                    sessionTokenHash: tokenHash,
                    expiresAt: session.expiresAt,
                    renewableUntil: session.renewableUntil ?? session.expiresAt,
                    authMethod: 'session'
                });
            }

            if (targetConfig.type === 'anonymous' && !service && !user && !session) {
                return new AuthData({
                    tenant: undefined,
                    user: undefined,
                    service: undefined,
                    targetType: sessionTypes.enum.anonymous,
                    sessionTokenHash: '',
                    expiresAt: new Date(0),
                    renewableUntil: new Date(0),
                    authMethod: 'session'
                });
            }
        }

        // If no target matched, throw an error
        const attemptedTypes = opts.targets.map((t) => t.type).join(', ');
        this.logger.debug({ attemptedTypes }, 'No matching authentication type found');
        throw new UnauthorizedError('Invalid session');
    }

    private async extractSession(request: FastifyRequest) {
        const token = this.extractToken(request);
        if (token === null) {
            return {
                session: undefined,
                user: undefined,
                tenant: undefined,
                service: undefined,
                tokenHash: undefined
            };
        }

        const tokenHash = SessionService.hashToken(token);
        const session = await this.repos.sessions.findActiveByTokenHash(tokenHash);
        if (!session) {
            this.logger.debug('Invalid session');
            throw new UnauthorizedError('Invalid session');
        }

        // Scope enforcement: docs-scoped sessions must not grant access outside /docs.
        if (session.scope === 'docs' && !isDocsRequest(request)) {
            this.logger.debug(
                { scope: session.scope, url: request.url },
                'Rejecting docs-scoped session on non-docs route'
            );
            throw new UnauthorizedError('Invalid session');
        }

        if (session.userId) {
            const user = await this.repos.users.findByIdWithRoles(session.userId);
            if (!user) {
                this.logger.debug('Session with invalid user id');
                throw new UnauthorizedError('Invalid session');
            }
            if (belongsToDeletedOrganization(user)) {
                this.logger.debug({ organizationId: user.organizationId }, 'Session of a deleted organization');
                throw new UnauthorizedError('Invalid session');
            }
            return { session, user, tokenHash };
        }

        if (session.tenantId) {
            const tenant = await this.repos.tenants.getByIdWithRoles(session.tenantId);
            if (!tenant) {
                this.logger.debug('Session with invalid tenant id');
                throw new UnauthorizedError('Invalid session');
            }
            return { session, tenant, tokenHash };
        }

        if (session.serviceId) {
            const service = await this.repos.services.findById(session.serviceId);
            if (!service) {
                this.logger.debug('Session with invalid service id');
                throw new UnauthorizedError('Invalid session');
            }
            return { session, service, tokenHash };
        }

        throw new Error('Unreachable code: no user, tenant or service found related to this session');
    }

    private extractToken(request: FastifyRequest): string | null {
        const header = this.extractTokenFromHeader(request);
        if (header !== null) return header;

        // Cookie fallback for browser-navigated /docs requests — Swagger UI is a server-rendered
        // HTML page, so the browser can't attach an Authorization header.
        if (isDocsRequest(request)) {
            return this.extractDocsCookie(request);
        }

        return null;
    }

    private extractTokenFromHeader(request: FastifyRequest): string | null {
        const authHeader = request.headers.authorization;
        if (authHeader === undefined || authHeader === '') {
            return null;
        }

        const parts = authHeader.split(' ');
        const [tokenType, token, ...rest] = parts;
        if (tokenType !== 'Bearer' || token === undefined || rest.length !== 0) {
            this.logger.debug('Invalid auth header format');
            throw new UnauthorizedError();
        }

        return token;
    }

    private extractDocsCookie(request: FastifyRequest): string | null {
        return request.cookies?.[DOCS_SESSION_COOKIE_NAME] ?? null;
    }

    private async handleUserAuth(
        request: FastifyRequest,
        user: UserWithRoles,
        requiredRoles: string[],
        requiredSystemPermissions: Permission[],
        session: Session,
        tokenHash: string
    ): Promise<AuthData> {
        if (requiredRoles.length > 0) {
            const userRoles = new Set(user.roles.map((r) => r.id));
            const missingRoles = requiredRoles.some((r) => !userRoles.has(r));
            if (missingRoles) {
                this.logger.debug(
                    {
                        event: 'authz.denied',
                        reason: 'missing_roles',
                        actorId: user.id,
                        actorType: ACTOR_TYPES.USER,
                        userRoles: [...userRoles],
                        requiredRoles
                    },
                    'authz.denied'
                );
                await this.emitAuthzDenied(request, user.id, user.organizationId, tokenHash, 'missing_roles', {
                    userRoles: [...userRoles],
                    requiredRoles
                });
                throw new ForbiddenError();
            }
        }

        if (requiredSystemPermissions.length > 0) {
            const missingPermissions = requiredSystemPermissions.filter((p) => !hasZoneSystemPermission(user, p));
            if (missingPermissions.length > 0) {
                this.logger.debug(
                    {
                        event: 'authz.denied',
                        reason: 'missing_system_permissions',
                        actorId: user.id,
                        actorType: ACTOR_TYPES.USER,
                        requiredSystemPermissions,
                        missingPermissions
                    },
                    'authz.denied'
                );
                await this.emitAuthzDenied(
                    request,
                    user.id,
                    user.organizationId,
                    tokenHash,
                    'missing_system_permissions',
                    {
                        requiredSystemPermissions,
                        missingPermissions
                    }
                );
                throw new ForbiddenError();
            }
        }

        return new AuthData({
            user,
            targetType: TargetTypes.enum.user,
            sessionTokenHash: tokenHash,
            expiresAt: session.expiresAt,
            renewableUntil: session.renewableUntil ?? session.expiresAt,
            authMethod: 'session'
        });
    }

    private async emitAuthzDenied(
        request: FastifyRequest,
        userId: string,
        organizationId: string | null,
        tokenHash: string,
        reason: string,
        details: Record<string, unknown>
    ): Promise<void> {
        const ctx: AuditLogContextData = {
            activeUserId: userId,
            activeTenantId: null,
            activeServiceId: null,
            activeOrganizationId: resolveActiveOrganizationId(request, organizationId),
            traceId: request.traceId ?? '',
            requestId: request.requestId ?? '',
            actorType: ACTOR_TYPES.USER,
            authSubject: tokenHash,
            auditContext: {
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'] as string | undefined
            }
        };
        try {
            await new AuditLogsService(request.repos).logSecurityEvent('authz.denied', 'user', userId, ctx, {
                reason,
                ...details
            });
        } catch (err) {
            this.logger.error({ err }, 'Failed to emit authz.denied audit event');
        }
    }
}
