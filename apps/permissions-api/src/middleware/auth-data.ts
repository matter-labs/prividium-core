import { forbiddenPermix, permixForM2mApp, permixForTenant, prividiumPermix } from '../permissions/prividium-permix';
import type { M2mApplication } from '../repositories/m2m-applications-repository';
import type { Service } from '../repositories/services-repository';
import type { TenantWithRoles } from '../repositories/tenants-repository';
import type { UserWithRoles } from '../repositories/users-repository';
import { UnauthorizedError } from '../utils/error-types';
import type { SessionType } from '../utils/schemas/auth';

export type AuthMethod = 'session' | 'api_key';

declare module 'fastify' {
    interface FastifyRequest {
        auth: AuthData;
    }
}

export class AuthData {
    private readonly user?: UserWithRoles;
    private readonly tenant?: TenantWithRoles;
    private readonly m2mApp?: M2mApplication;
    private readonly service?: Service;
    readonly targetType: SessionType;
    private readonly sessionTokenHash?: string;
    private readonly apiKeyId?: string;
    public readonly expiresAt: Date;
    public readonly renewableUntil: Date;
    public readonly authMethod: AuthMethod;

    constructor({
        user,
        tenant,
        m2mApp,
        service,
        targetType,
        sessionTokenHash,
        expiresAt,
        renewableUntil,
        authMethod,
        apiKeyId
    }: {
        user?: UserWithRoles;
        tenant?: TenantWithRoles;
        m2mApp?: M2mApplication;
        service?: Service;
        targetType: SessionType;
        sessionTokenHash?: string;
        expiresAt: Date;
        renewableUntil?: Date;
        authMethod: AuthMethod;
        apiKeyId?: string;
    }) {
        this.user = user;
        this.tenant = tenant;
        this.m2mApp = m2mApp;
        this.service = service;
        this.targetType = targetType;
        this.sessionTokenHash = sessionTokenHash;
        this.expiresAt = expiresAt;
        this.renewableUntil = renewableUntil ?? expiresAt;
        this.authMethod = authMethod;
        this.apiKeyId = apiKeyId;
    }

    get isApiKeyAuth(): boolean {
        return this.authMethod === 'api_key';
    }

    get isSessionAuth(): boolean {
        return this.authMethod === 'session';
    }

    currentApiKeyId(): string {
        if (this.apiKeyId === undefined) {
            throw new UnauthorizedError('Not authenticated with API key');
        }
        return this.apiKeyId;
    }

    currentUser(): UserWithRoles {
        if (this.user === undefined) {
            throw new UnauthorizedError('Wrong authentication type');
        }
        return this.user;
    }

    get displayName(): string | undefined {
        return this.user?.displayName;
    }

    get type(): SessionType {
        return this.targetType;
    }

    get tokenHash(): string {
        if (this.sessionTokenHash === undefined) {
            throw new UnauthorizedError('Not authenticated with session');
        }
        return this.sessionTokenHash;
    }

    currentTenant(): TenantWithRoles {
        if (this.tenant === undefined) {
            throw new UnauthorizedError('Wrong authentication type');
        }
        return this.tenant;
    }

    currentService(): Service {
        if (this.service === undefined) {
            throw new UnauthorizedError('Wrong authentication type');
        }
        return this.service;
    }

    currentM2mApp(): M2mApplication {
        if (this.m2mApp === undefined) {
            throw new UnauthorizedError('Wrong authentication type');
        }
        return this.m2mApp;
    }

    async dispatch<T, E extends Error>(
        cases: Partial<Record<SessionType, () => Promise<T> | T>>,
        error: E
    ): Promise<T> {
        const handler = cases[this.targetType];
        if (handler === undefined) {
            throw error;
        }

        return handler();
    }

    actorId(): string | null {
        switch (this.targetType) {
            case 'user':
                return this.currentUser().id;
            case 'tenant':
                return this.currentTenant().id;
            case 'service':
                return this.currentService().id;
            case 'm2m_app':
                return this.currentM2mApp().id;
            case 'anonymous':
                return null;
            default:
                throw new Error(`unknown auth type: ${this.targetType}`);
        }
    }

    permix() {
        if (this.user !== undefined) {
            return prividiumPermix(this.user);
        }

        if (this.m2mApp !== undefined) {
            return permixForM2mApp(this.m2mApp);
        }

        if (this.tenant !== undefined) {
            return permixForTenant(this.tenant);
        }

        return forbiddenPermix();
    }
}
