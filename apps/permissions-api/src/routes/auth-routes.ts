import { AUDIT_ACTIONS, requiresMfa } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import type { SessionsAuthValidator } from '../middleware/sessions-auth';
import type { AdminMfaService } from '../services/admin-mfa-service';
import { type AuditLogsService, auditLogContext } from '../services/audit-logs-service';
import type { JwtValidatorService } from '../services/jwt-validator-service';
import type { SessionService } from '../services/session-service';
import type { SiweService } from '../services/siwe-service';
import { ForbiddenError, UnauthorizedError, WalletNotLinkedError } from '../utils/error-types';
import { currentSessionSchema, sessionTypes } from '../utils/schemas/auth';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { hexSchema } from '../utils/schemas/hex-schema';
import { WebAuthnAuthenticationResponseSchema } from '../utils/schemas/webauthn';
import { AuthResponseSchema, AuthResponseWithMfaSchema } from './schemas/auth';

interface Deps {
    jwtValidatorService: JwtValidatorService;
    sessionService: SessionService;
    sessionAuthValidator: SessionsAuthValidator;
    siweService: SiweService;
    auditLogsService: AuditLogsService;
    adminMfaService: AdminMfaService;
    tenantsEnabled: boolean;
}

export function authRoutes(
    server: FastifyServer,
    {
        jwtValidatorService,
        sessionService,
        sessionAuthValidator,
        siweService,
        auditLogsService,
        adminMfaService,
        tenantsEnabled
    }: Deps
) {
    server.post(
        '/login/oidc',
        {
            schema: {
                description: 'Login with OIDC',
                tags: ['auth'],
                body: z.object({
                    jwt: z.jwt(),
                    passkeyAssertion: WebAuthnAuthenticationResponseSchema.optional()
                }),
                response: {
                    200: AuthResponseWithMfaSchema,
                    400: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    429: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const context = auditLogContext(req, auditLogsService);
            const { jwt, passkeyAssertion } = req.body;
            try {
                const data = await jwtValidatorService.validateOidc({ jwt });

                // admin-panel write access requires MFA before a session is issued
                if (requiresMfa(data.user)) {
                    const mfaResult = await adminMfaService.handleMfa({
                        user: data.user,
                        passkeyAssertion,
                        ctx: context
                    });

                    if (mfaResult.type === 'mfa_challenge') {
                        return {
                            requiresMfa: true,
                            rpId: mfaResult.rpId,
                            challenge: mfaResult.challenge,
                            allowCredentials: mfaResult.allowCredentials.map((c) => ({
                                id: c.id,
                                type: 'public-key' as const,
                                transports: c.transports
                            }))
                        } as const;
                    }

                    mfaResult.type satisfies 'success';
                }

                const { token, expiresAt, renewableUntil } = await sessionService.createUserSession({
                    userId: data.user.id,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                });
                context.setActiveUser(data.user.id, data.user.organizationId);
                await context.logSecurityEvent('auth.login_succeeded', 'user', data.user.id, { method: 'oidc' });
                return {
                    token,
                    expiresAt: expiresAt.toISOString(),
                    renewableUntil: renewableUntil.toISOString()
                };
            } catch (err) {
                if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
                    try {
                        context.activeOrganizationId = await jwtValidatorService.organizationIdForJwt(jwt);
                        await context.logSecurityEvent('auth.login_failed', 'user', undefined, {
                            method: 'oidc',
                            reason: err.message
                        });
                    } catch (auditErr) {
                        req.log.error({ err: auditErr }, 'Failed to write auth.login_failed audit log');
                    }
                }
                throw err;
            }
        }
    );

    server.post(
        '/login/crypto-native',
        {
            schema: {
                description: 'Login with Crypto Native',
                tags: ['auth'],
                body: z.object({
                    message: z.string(),
                    signature: hexSchema,
                    nonceToken: z.string(),
                    passkeyAssertion: WebAuthnAuthenticationResponseSchema.optional()
                }),
                response: {
                    200: AuthResponseWithMfaSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    429: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const context = auditLogContext(req, auditLogsService);
            const { message, signature, nonceToken, passkeyAssertion } = req.body;
            try {
                // nonce not consumed yet
                const siweMessage = await siweService.validateSiweDeferred({ message, signature, nonceToken });

                if (siweMessage.targetType !== 'user') {
                    throw new ForbiddenError();
                }

                // userId bound at challenge time, so mid-flight wallet reassignment can't redirect the session
                const user = siweMessage.targetId
                    ? await req.repos.users.findByIdWithRoles(siweMessage.targetId)
                    : await req.repos.users.findByAddressWithRoles(siweMessage.address);
                if (!user) {
                    throw new WalletNotLinkedError();
                }

                if (!requiresMfa(user)) {
                    const consumed = await siweService.consumeSiweNonce(siweMessage.nonce);
                    if (!consumed) {
                        throw new UnauthorizedError();
                    }
                    const { token, expiresAt, renewableUntil } = await sessionService.createUserSession({
                        userId: user.id,
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent']
                    });

                    context.setActiveUser(user.id, user.organizationId);
                    await context.logSecurityEvent('auth.login_succeeded', 'user', user.id, {
                        method: 'crypto_native'
                    });
                    return {
                        token,
                        expiresAt: expiresAt.toISOString(),
                        renewableUntil: renewableUntil.toISOString()
                    };
                }

                const mfaResult = await adminMfaService.handleMfa({
                    user,
                    passkeyAssertion,
                    ctx: context,
                    linkedSiweNonce: siweMessage.nonce
                });

                // nonce consumed on the follow-up request after MFA success, not here
                if (mfaResult.type === 'mfa_challenge') {
                    return {
                        requiresMfa: true as const,
                        rpId: mfaResult.rpId,
                        challenge: mfaResult.challenge,
                        allowCredentials: mfaResult.allowCredentials.map((c) => ({
                            id: c.id,
                            type: 'public-key' as const,
                            transports: c.transports
                        }))
                    };
                }

                mfaResult.type satisfies 'success';

                if (mfaResult.linkedSiweNonce !== siweMessage.nonce) {
                    throw new UnauthorizedError('SIWE nonce mismatch');
                }

                const consumed = await siweService.consumeSiweNonce(siweMessage.nonce);
                if (!consumed) {
                    throw new UnauthorizedError();
                }

                const { token, expiresAt, renewableUntil } = await sessionService.createUserSession({
                    userId: user.id,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                });

                context.setActiveUser(user.id, user.organizationId);
                await context.logSecurityEvent('auth.login_succeeded', 'user', user.id, {
                    method: 'crypto_native'
                });
                return {
                    token,
                    expiresAt: expiresAt.toISOString(),
                    renewableUntil: renewableUntil.toISOString()
                };
            } catch (err) {
                if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
                    try {
                        await context.logSecurityEvent('auth.login_failed', 'user', undefined, {
                            method: 'crypto_native',
                            reason: err.message
                        });
                    } catch (auditErr) {
                        req.log.error({ err: auditErr }, 'Failed to write auth.login_failed audit log');
                    }
                }
                throw err;
            }
        }
    );

    if (tenantsEnabled) {
        server.post(
            '/login/tenant',
            {
                schema: {
                    description: 'Tenant login',
                    tags: ['auth'],
                    body: z.object({ message: z.string(), signature: hexSchema, nonceToken: z.string() }),
                    response: {
                        200: AuthResponseSchema,
                        400: ErrorResponseSchema,
                        403: ErrorResponseSchema
                    }
                }
            },
            async (req) => {
                const context = auditLogContext(req, auditLogsService);
                try {
                    const siweMessage = await siweService.validateSiwe(req.body);

                    if (siweMessage.targetType !== 'tenant') {
                        throw new ForbiddenError();
                    }
                    const tenant = await req.repos.tenants.findByPublicKey(siweMessage.address);
                    if (!tenant) {
                        throw new UnauthorizedError();
                    }

                    const { token, expiresAt, renewableUntil } = await sessionService.createTenantSession({
                        tenantId: tenant.id,
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent']
                    });

                    await context.logSecurityEvent('auth.login_succeeded', 'tenant', tenant.id, {
                        method: 'crypto_native'
                    });
                    return {
                        token,
                        expiresAt: expiresAt.toISOString(),
                        renewableUntil: renewableUntil.toISOString()
                    };
                } catch (err) {
                    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
                        try {
                            await context.logSecurityEvent('auth.login_failed', 'tenant', undefined, {
                                method: 'crypto_native',
                                reason: err.message
                            });
                        } catch (auditErr) {
                            req.log.error({ err: auditErr }, 'Failed to write auth.login_failed audit log');
                        }
                    }
                    throw err;
                }
            }
        );
    }

    server.post(
        '/login/service',
        {
            schema: {
                description: 'Service login',
                tags: ['auth'],
                body: z.object({ message: z.string(), signature: hexSchema, nonceToken: z.string() }),
                response: {
                    200: AuthResponseSchema,
                    400: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const context = auditLogContext(req, auditLogsService);
            try {
                const siweMessage = await siweService.validateSiwe(req.body);

                if (siweMessage.targetType !== 'service') {
                    throw new ForbiddenError();
                }
                const service = await req.repos.services.findByPublicKey(siweMessage.address);
                if (!service) {
                    throw new UnauthorizedError();
                }

                const { token, expiresAt, renewableUntil } = await sessionService.createServiceSession({
                    serviceId: service.id,
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent']
                });

                await context.logSecurityEvent('auth.login_succeeded', 'service', service.id, {
                    method: 'crypto_native'
                });
                return {
                    token,
                    expiresAt: expiresAt.toISOString(),
                    renewableUntil: renewableUntil.toISOString()
                };
            } catch (err) {
                if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
                    try {
                        await context.logSecurityEvent('auth.login_failed', 'service', undefined, {
                            method: 'crypto_native',
                            reason: err.message
                        });
                    } catch (auditErr) {
                        req.log.error({ err: auditErr }, 'Failed to write auth.login_failed audit log');
                    }
                }
                throw err;
            }
        }
    );

    server.post(
        '/logout',
        {
            config: { audit_action: AUDIT_ACTIONS.AUTH_LOGOUT },
            onRequest: [
                sessionAuthValidator.buildHook({
                    targets: [
                        { type: sessionTypes.enum.user },
                        ...(tenantsEnabled ? ([{ type: sessionTypes.enum.tenant }] as const) : []),
                        { type: sessionTypes.enum.service }
                    ]
                })
            ],
            schema: {
                description: 'Logout',
                tags: ['auth'],
                response: {
                    204: z.null(),
                    401: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            await sessionService.deleteSession(req.auth.tokenHash);
            return reply.status(204).send(null);
        }
    );

    server.get(
        '/current-session',
        {
            onRequest: [
                sessionAuthValidator.buildHook({
                    targets: [
                        { type: sessionTypes.enum.user },
                        ...(tenantsEnabled ? ([{ type: sessionTypes.enum.tenant }] as const) : []),
                        { type: sessionTypes.enum.service }
                    ]
                })
            ],
            schema: {
                description: 'Get current session information',
                tags: ['auth'],
                response: {
                    200: currentSessionSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { type, expiresAt, renewableUntil } = req.auth;
            return reply.status(200).send({
                type,
                expiresAt: expiresAt.toISOString(),
                renewableUntil: renewableUntil.toISOString()
            });
        }
    );

    const ExtendSessionResponseSchema = z.object({
        expiresAt: z.iso.datetime(),
        renewableUntil: z.iso.datetime()
    });

    server.post(
        '/extend-session',
        {
            config: { audit_action: AUDIT_ACTIONS.SESSION_EXTEND },
            onRequest: [
                // Idle extension is a user-session concern only. Tenant and service principals
                // mint their own tokens programmatically, so they have no reason to extend; the
                // service layer also no-ops for them, but we reject them at the door here.
                sessionAuthValidator.buildHook({
                    targets: [{ type: sessionTypes.enum.user }]
                })
            ],
            schema: {
                description: 'Extend the current session idle deadline',
                tags: ['auth'],
                response: {
                    200: ExtendSessionResponseSchema,
                    401: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { expiresAt, renewableUntil, extended } = await sessionService.extendSession(req.auth.tokenHash);
            // These routes are registered in the public scope, which has no audit-context
            // preHandler — the declared audit_action never fires, so emit by hand as the login
            // handlers above do. Only when the deadline moved: clients poll this every idle
            // interval per open tab, and the no-op calls would bury the real ones.
            if (extended) {
                const context = auditLogContext(req, auditLogsService);
                await context.logSecurityEvent(AUDIT_ACTIONS.SESSION_EXTEND, 'session', undefined, {
                    expiresAt: expiresAt.toISOString()
                });
            }
            return reply.status(200).send({
                expiresAt: expiresAt.toISOString(),
                renewableUntil: renewableUntil.toISOString()
            });
        }
    );
}
