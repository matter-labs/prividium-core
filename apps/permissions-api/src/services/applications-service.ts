import type { Repositories } from '../db';
import type {
    Application,
    InsertApplication,
    PublicApplication,
    PublicApplicationCard,
    UpdateApplication
} from '../repositories/applications-repository';
import { secureRandomString } from '../utils/crypto';
import { InvalidEntity } from '../utils/error-types';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';

export type ApplicationServiceOpts = {
    blockExplorerRedirectUris: string[];
    adminPanelRedirectUris: string[];
    swaggerDocsRedirectUris: string[];
    cacheDurationMs: number;
};

/**
 * Which session the user panel hands a client on authorize. 'account': the user's own session (the admin
 * panel needs admin routes; the docs exchange requires an unscoped token). 'application': a session bound
 * to the client, accepted only on the application surface.
 */
export type SessionKind = 'account' | 'application';

export const ACCOUNT_SESSION_CLIENT_IDS: ReadonlySet<string> = new Set(['admin-panel', 'swagger-docs']);

export type OauthClient = PublicApplication & { sessionKind: SessionKind };

function sessionKindFor(oauthClientId: string): SessionKind {
    return ACCOUNT_SESSION_CLIENT_IDS.has(oauthClientId) ? 'account' : 'application';
}

export class ApplicationsService {
    private readonly staticPerpetualApps: Record<string, Application>;
    private byClientIdCache: Map<string, { app: PublicApplication; expiresAt: number }>;
    private allAppOriginsCache: string[];
    private appOriginsCacheExpiration: number;
    private readonly cacheDurationMs: number;
    private readonly swaggerDocsRedirectUris: string[];

    constructor(
        private readonly repos: Repositories,
        opts: ApplicationServiceOpts
    ) {
        this.staticPerpetualApps = buildStaticPerpetualApps(opts);
        this.byClientIdCache = new Map();
        this.allAppOriginsCache = [];
        this.appOriginsCacheExpiration = 0; // expired → first call always refreshes
        this.cacheDurationMs = opts.cacheDurationMs;
        this.swaggerDocsRedirectUris = opts.swaggerDocsRedirectUris;
    }

    private perpetualApps(selfOrigin?: string): Record<string, Application> {
        return {
            ...this.staticPerpetualApps,
            'swagger-docs': buildSwaggerDocsPerpetual(this.swaggerDocsRedirectUris, selfOrigin)
        };
    }

    async checkOriginCache(force = false): Promise<void> {
        if (force || Date.now() > this.appOriginsCacheExpiration) {
            this.allAppOriginsCache = await this.repos.applications.allAppOrigins();
            this.appOriginsCacheExpiration = Date.now() + this.cacheDurationMs;
        }
    }

    private invalidateOriginsCache(): void {
        this.appOriginsCacheExpiration = 0;
    }

    async allAppOrigins(): Promise<string[]> {
        await this.checkOriginCache();
        return this.allAppOriginsCache;
    }

    async getById(id: string, selfOrigin?: string): Promise<Application> {
        return this.perpetualApp(id, selfOrigin) ?? this.repos.applications.getById(id);
    }

    async getByOauthClientId(clientId: string, selfOrigin?: string): Promise<OauthClient> {
        const app = await this.findPublicApplication(clientId, selfOrigin);
        return { ...app, sessionKind: sessionKindFor(app.oauthClientId) };
    }

    /**
     * Uncached lookup for issuing a session: share-locks the row in the caller's transaction, so a delete on any
     * replica waits for that transaction and then revokes the session it created. Perpetual clients are never deleted.
     */
    async lockByOauthClientId(txRepos: Repositories, clientId: string, selfOrigin?: string): Promise<OauthClient> {
        const app =
            this.perpetualApp(clientId, selfOrigin) ?? (await txRepos.applications.lockByOauthClientId(clientId));
        return { ...app, sessionKind: sessionKindFor(app.oauthClientId) };
    }

    private perpetualApp(clientId: string, selfOrigin?: string): Application | undefined {
        const perpetual = this.perpetualApps(selfOrigin);
        return Object.hasOwn(perpetual, clientId) ? perpetual[clientId] : undefined;
    }

    private async findPublicApplication(clientId: string, selfOrigin?: string): Promise<PublicApplication> {
        // Perpetual apps use id === oauthClientId, return the full object (typed as PublicApplication)
        const perpetual = this.perpetualApp(clientId, selfOrigin);
        if (perpetual !== undefined) {
            return perpetual as PublicApplication;
        }

        const inCache = this.byClientIdCache.get(clientId);
        if (inCache !== undefined && Date.now() <= inCache.expiresAt) {
            return inCache.app;
        }

        const app = await this.repos.applications.getByOauthClientId(clientId);
        this.byClientIdCache.set(clientId, { app, expiresAt: Date.now() + this.cacheDurationMs });
        return app;
    }

    async searchPaginated(
        { limit, offset }: PaginationParams,
        selfOrigin?: string
    ): Promise<PaginatedResult<Application>> {
        const perpetual = Object.values(this.perpetualApps(selfOrigin));
        const perpetualAppsLength = perpetual.length;

        let perpetualToShow: Application[];
        let dbLimit: number;
        let dbOffset: number;
        if (offset <= perpetualAppsLength) {
            perpetualToShow = perpetual.slice(offset);
            dbLimit = Math.max(limit - perpetualToShow.length, 0);
            dbOffset = 0;
        } else {
            perpetualToShow = [];
            dbLimit = limit;
            dbOffset = offset - perpetualAppsLength;
        }

        const dbResult = await this.repos.applications.findPaginated({ limit: dbLimit, offset: dbOffset });
        const totalItems = dbResult.pagination.totalItems + perpetualAppsLength;
        const currentPage = Math.floor(offset / limit) + 1;
        const totalPages = Math.ceil(totalItems / limit);

        return {
            items: [...perpetualToShow, ...dbResult.items],
            pagination: { currentPage, totalPages, totalItems, limit, offset }
        };
    }

    async searchPublicPaginated({ limit, offset }: PaginationParams): Promise<PaginatedResult<PublicApplicationCard>> {
        // Public listing doesn't include swagger-docs (isPublic=false), so selfOrigin is irrelevant.
        const publicPerpetual = Object.values(this.perpetualApps())
            .filter((app) => app.isPublic)
            .map((app) => ({
                id: app.id,
                name: app.name,
                description: app.description,
                imageUrl: app.imageUrl,
                origin: app.origin
            }));
        const perpetualCount = publicPerpetual.length;

        let perpetualToShow: PublicApplicationCard[];
        let dbLimit: number;
        let dbOffset: number;
        if (offset <= perpetualCount) {
            perpetualToShow = publicPerpetual.slice(offset);
            dbLimit = Math.max(limit - perpetualToShow.length, 0);
            dbOffset = 0;
        } else {
            perpetualToShow = [];
            dbLimit = limit;
            dbOffset = offset - perpetualCount;
        }

        const dbResult = await this.repos.applications.searchPublicPaginated({ limit: dbLimit, offset: dbOffset });
        const totalItems = dbResult.pagination.totalItems + perpetualCount;
        const currentPage = Math.floor(offset / limit) + 1;
        const totalPages = Math.ceil(totalItems / limit);

        return {
            items: [...perpetualToShow, ...dbResult.items],
            pagination: { currentPage, totalPages, totalItems, limit, offset }
        };
    }

    // `oauthClientId` is server-managed: generated here so callers can never set it.
    async create(data: Omit<InsertApplication, 'oauthClientId'>): Promise<Application> {
        const created = await this.repos.applications.create({ ...data, oauthClientId: secureRandomString(16) });
        this.invalidateOriginsCache();
        return created;
    }

    async update(appId: string, params: UpdateApplication): Promise<Application> {
        const updated = await this.repos.transaction(async (tx) => {
            const txRepos = tx.repositories();
            const existing = await txRepos.applications.getById(appId);
            const result = await txRepos.applications.updateById(appId, params);
            this.byClientIdCache.delete(existing.oauthClientId);
            return result;
        });
        this.invalidateOriginsCache();
        return updated;
    }

    /** Deleting a client also revokes every session it was issued, so its tokens stop working with it. */
    async delete(appId: string, deletedByUserId: string): Promise<void> {
        if (this.perpetualApp(appId) !== undefined) {
            throw new InvalidEntity('Perpetual apps cannot be removed');
        }

        await this.repos.transaction(async (tx) => {
            const txRepos = tx.repositories();
            const existing = await txRepos.applications.getById(appId);
            await txRepos.applications.deleteById(appId);
            await txRepos.sessions.revokeAllByOauthClientId(existing.oauthClientId, deletedByUserId);
            this.byClientIdCache.delete(existing.oauthClientId);
        });
        this.invalidateOriginsCache();
    }
}

const PERPETUAL_APP_TIMESTAMP = new Date(0);

function buildStaticPerpetualApps(opts: ApplicationServiceOpts): Record<string, Application> {
    return {
        'block-explorer': {
            id: 'block-explorer',
            name: 'Block Explorer',
            oauthClientId: 'block-explorer',
            oauthRedirectUris: opts.blockExplorerRedirectUris,
            origin: null,
            isPublic: true,
            description:
                'Private and access-controlled blockchain explorer provides all the information to deep dive into transactions, blocks, contracts, and much more.',
            imageUrl: null,
            createdAt: PERPETUAL_APP_TIMESTAMP,
            updatedAt: PERPETUAL_APP_TIMESTAMP
        },
        'admin-panel': {
            id: 'admin-panel',
            name: 'Admin Panel',
            oauthClientId: 'admin-panel',
            oauthRedirectUris: opts.adminPanelRedirectUris,
            origin: null,
            isPublic: true,
            description:
                'Centralized administration dashboard for managing users, applications, permissions, and network configuration.',
            imageUrl: null,
            createdAt: PERPETUAL_APP_TIMESTAMP,
            updatedAt: PERPETUAL_APP_TIMESTAMP
        },
        'proxy-cli': {
            id: 'proxy-cli',
            name: 'Proxy CLI',
            oauthClientId: 'proxy-cli',
            oauthRedirectUris: ['http://localhost:24101/callback', 'http://127.0.0.1:24101/callback'],
            origin: null,
            isPublic: false,
            description: 'Command-line interface for interacting with the proxy.',
            imageUrl: null,
            createdAt: PERPETUAL_APP_TIMESTAMP,
            updatedAt: PERPETUAL_APP_TIMESTAMP
        }
    };
}

function buildSwaggerDocsPerpetual(staticRedirectUris: string[], selfOrigin?: string): Application {
    const oauthRedirectUris = selfOrigin
        ? [...new Set([...staticRedirectUris, `${selfOrigin}/docs/callback`])]
        : staticRedirectUris;
    return {
        id: 'swagger-docs',
        name: 'Swagger Docs',
        oauthClientId: 'swagger-docs',
        oauthRedirectUris,
        origin: null,
        isPublic: false,
        description: 'Permissions API documentation (Swagger UI).',
        imageUrl: null,
        createdAt: PERPETUAL_APP_TIMESTAMP,
        updatedAt: PERPETUAL_APP_TIMESTAMP
    };
}
