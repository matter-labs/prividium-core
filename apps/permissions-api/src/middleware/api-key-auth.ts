import { ACTOR_TYPES, AUDIT_ACTIONS } from '@repo/access-control';
import type { FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import type { Repositories } from '../db';
import type { AuditActionType } from '../db/schema';
import type { ApiKey } from '../repositories/api-keys-repository';
import type { ApiKeyService } from '../services/api-key-service';
import type { AuditLogsService } from '../services/audit-logs-service';
import { UnauthorizedError } from '../utils/error-types';
import type { PinoLogger } from '../utils/logger';
import type { SessionType } from '../utils/schemas/auth';
import { AuthData } from './auth-data';

export const API_KEY_HEADER = 'x-api-key';

export type ApiKeyTarget = Extract<SessionType, 'm2m_app' | 'tenant'>;

const LAST_USED_UPDATE_INTERVAL_MS = 1000;

export class ApiKeyAuthValidator {
    private logger: PinoLogger;
    private apiKeyService: ApiKeyService;
    private repos: Repositories;
    private auditLogsService: AuditLogsService;
    private lastUsedCache = new Map<string, number>(); // keyId -> last update timestamp (ms)

    constructor({
        logger,
        apiKeyService,
        repos,
        auditLogsService
    }: {
        logger: PinoLogger;
        apiKeyService: ApiKeyService;
        repos: Repositories;
        auditLogsService: AuditLogsService;
    }) {
        this.logger = logger;
        this.apiKeyService = apiKeyService;
        this.repos = repos;
        this.auditLogsService = auditLogsService;
    }

    buildHook(target: ApiKeyTarget) {
        return async (request: FastifyRequest) => {
            request.auth = await this.extractAuthDataForTargets(request, [target]);
        };
    }

    buildSyncHook(target: ApiKeyTarget) {
        const hook = this.buildHook(target);
        return (req: FastifyRequest, _res: unknown, done: HookHandlerDoneFunction) => {
            hook(req).then(
                () => done(),
                (e) => done(e)
            );
        };
    }

    async extractTenantAuthData(request: FastifyRequest): Promise<AuthData> {
        return this.extractAuthDataForTargets(request, ['tenant']);
    }

    async extractM2mAppAuthData(request: FastifyRequest): Promise<AuthData> {
        return this.extractAuthDataForTargets(request, ['m2m_app']);
    }

    async extractAuthDataForTargets(request: FastifyRequest, allowedTargets: ApiKeyTarget[]): Promise<AuthData> {
        if (allowedTargets.length === 0) {
            throw new UnauthorizedError('Invalid API key');
        }

        const apiKey = await this.extractApiKeyFromHeader(request);
        const apiKeyRecord = await this.findActiveApiKey(request, apiKey);
        const target = this.getApiKeyTarget(apiKeyRecord);

        if (!allowedTargets.includes(target)) {
            await this.logAuthFailure(request, this.getTargetConfig(target).validationErrors.invalidKey, {
                reason: 'invalid_api_key',
                keyPrefix: apiKeyRecord.keyPrefix,
                [this.getTargetConfig(target).column]: apiKeyRecord[this.getTargetConfig(target).column]!
            });
            throw new UnauthorizedError('Invalid API key');
        }

        await this.ensureIpAllowed(request, apiKeyRecord, target);
        await this.maybeUpdateLastUsed(apiKeyRecord.id, this.getIp(request));

        return this.createAuthData(request, apiKeyRecord, target);
    }

    private async extractApiKeyFromHeader(request: FastifyRequest): Promise<string> {
        const apiKey = request.headers[API_KEY_HEADER];

        if (apiKey === undefined || apiKey === '') {
            this.logger.debug('Missing X-API-Key header');
            await this.logAuthFailure(request, AUDIT_ACTIONS.API_KEY_AUTH_FAILURE_INVALID_KEY, {
                reason: 'missing_header'
            });
            throw new UnauthorizedError('Missing API key');
        }

        if (Array.isArray(apiKey)) {
            this.logger.debug('Multiple X-API-Key headers provided');
            await this.logAuthFailure(request, AUDIT_ACTIONS.API_KEY_AUTH_FAILURE_INVALID_KEY, {
                reason: 'multiple_headers'
            });
            throw new UnauthorizedError('Invalid API key');
        }

        if (!this.apiKeyService.validateFormat(apiKey)) {
            this.logger.debug('Invalid API key format');
            await this.logAuthFailure(request, AUDIT_ACTIONS.API_KEY_AUTH_FAILURE_INVALID_KEY, {
                reason: 'invalid_format'
            });
            throw new UnauthorizedError('Invalid API key');
        }

        return apiKey;
    }

    private async logAuthFailure(
        request: FastifyRequest,
        actionType: AuditActionType,
        details: { reason: string; keyPrefix?: string; tenantId?: string; m2mAppId?: string }
    ): Promise<void> {
        await this.auditLogsService.logSecurityEvent(
            actionType,
            'api-key',
            undefined,
            {
                activeUserId: null,
                activeTenantId: details.tenantId ?? null,
                activeServiceId: null,
                traceId: request.traceId ?? '',
                requestId: request.requestId ?? '',
                actorType: ACTOR_TYPES.ANONYMOUS,
                authSubject: null,
                auditContext: {
                    ipAddress: this.getIp(request),
                    userAgent: request.headers['user-agent']
                }
            },
            {
                reason: details.reason,
                keyPrefix: details.keyPrefix,
                clientIp: this.getIp(request),
                requestPath: request.url,
                requestMethod: request.method,
                m2mAppId: details.m2mAppId
            }
        );
    }

    private async findActiveApiKey(request: FastifyRequest, apiKey: string) {
        const keyHash = this.apiKeyService.hash(apiKey);
        const apiKeyRecord = await this.repos.apiKeys.findActiveByKeyHash(keyHash);

        if (!apiKeyRecord) {
            this.logger.debug('API key not found or inactive');
            await this.logAuthFailure(request, AUDIT_ACTIONS.API_KEY_AUTH_FAILURE_INVALID_KEY, {
                reason: 'not_found_or_inactive',
                keyPrefix: this.apiKeyService.extractPrefix(apiKey)
            });
            throw new UnauthorizedError('Invalid API key');
        }

        return apiKeyRecord;
    }

    private async ensureIpAllowed(request: FastifyRequest, apiKeyRecord: ApiKey, target: ApiKeyTarget) {
        const targetConfig = this.getTargetConfig(target);
        const targetId = apiKeyRecord[targetConfig.column];

        if (!targetId) {
            await this.logAuthFailure(request, targetConfig.validationErrors.invalidKey, {
                reason: 'invalid_api_key',
                keyPrefix: apiKeyRecord.keyPrefix
            });
            throw new UnauthorizedError('Invalid API key');
        }

        const isIpAllowed = await targetConfig.isIpAllowed(targetId, this.getIp(request));
        if (!isIpAllowed) {
            this.logger.debug(
                {
                    target,
                    targetId,
                    clientIp: this.getIp(request),
                    xForwardedFor: request.headers['x-forwarded-for'],
                    keyId: apiKeyRecord.id
                },
                'IP not in whitelist'
            );
            await this.logAuthFailure(request, targetConfig.validationErrors.ipBlocked, {
                reason: 'ip_not_whitelisted',
                keyPrefix: apiKeyRecord.keyPrefix,
                [targetConfig.column]: targetId
            });
            throw new UnauthorizedError('Invalid API key');
        }
    }

    private async maybeUpdateLastUsed(keyId: string, ip: string | null): Promise<void> {
        const now = Date.now();
        const last = this.lastUsedCache.get(keyId);
        if (last !== undefined && now - last < LAST_USED_UPDATE_INTERVAL_MS) {
            return;
        }
        this.lastUsedCache.set(keyId, now);
        await this.repos.apiKeys.updateLastUsed(keyId, ip);
    }

    private getIp(request: FastifyRequest) {
        return request.ip;
    }

    private getApiKeyTarget(apiKeyRecord: ApiKey): ApiKeyTarget {
        if (apiKeyRecord.m2mAppId) {
            return 'm2m_app';
        }

        if (apiKeyRecord.tenantId) {
            return 'tenant';
        }

        throw new UnauthorizedError('Invalid API key');
    }

    private async createAuthData(
        request: FastifyRequest,
        apiKeyRecord: ApiKey,
        target: ApiKeyTarget
    ): Promise<AuthData> {
        if (target === 'tenant') {
            const tenant = await this.repos.tenants.getByIdWithRoles(apiKeyRecord.tenantId!);
            return new AuthData({
                tenant,
                targetType: target,
                expiresAt: apiKeyRecord.expiresAt,
                authMethod: 'api_key',
                apiKeyId: apiKeyRecord.id
            });
        }

        const m2mApp = await this.repos.m2mApps.getForAuth(apiKeyRecord.m2mAppId!);
        if (m2mApp.ownerOrganizationId !== null) {
            const activeOrgId = await this.repos.organizations.findActiveId(m2mApp.ownerOrganizationId);
            if (activeOrgId === undefined) {
                this.logger.debug(
                    { m2mAppId: m2mApp.id, ownerOrganizationId: m2mApp.ownerOrganizationId },
                    'API key of a deleted organization'
                );
                await this.logAuthFailure(request, this.getTargetConfig(target).validationErrors.invalidKey, {
                    reason: 'organization_deleted',
                    keyPrefix: apiKeyRecord.keyPrefix,
                    m2mAppId: m2mApp.id
                });
                throw new UnauthorizedError('Invalid API key');
            }
        }

        return new AuthData({
            m2mApp,
            targetType: target,
            expiresAt: apiKeyRecord.expiresAt,
            authMethod: 'api_key',
            apiKeyId: apiKeyRecord.id
        });
    }

    private getTargetConfig(target: ApiKeyTarget) {
        const validations = {
            tenant: {
                column: 'tenantId',
                isIpAllowed: (id: string, ip: string) => this.repos.ipWhitelist.isTenantIpAllowed(id, ip),
                validationErrors: {
                    invalidKey: 'tenant.api-key.auth-failure.invalid-key',
                    ipBlocked: 'tenant.api-key.auth-failure.ip-blocked'
                }
            },
            m2m_app: {
                column: 'm2mAppId',
                isIpAllowed: (id: string, ip: string) => this.repos.ipWhitelist.isM2mAppIpAllowed(id, ip),
                validationErrors: {
                    invalidKey: 'm2m-app.api-key.auth-failure.invalid-key',
                    ipBlocked: 'm2m-app.api-key.auth-failure.ip-blocked'
                }
            }
        } satisfies Record<
            ApiKeyTarget,
            {
                column: keyof ApiKey;
                isIpAllowed: (id: string, ip: string) => Promise<boolean>;
                validationErrors: {
                    invalidKey: AuditActionType;
                    ipBlocked: AuditActionType;
                };
            }
        >;

        return validations[target];
    }
}
