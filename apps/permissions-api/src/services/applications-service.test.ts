import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { ApplicationsService } from './applications-service';

describe('ApplicationsService', () => {
    let service: ApplicationsService;
    let otherServiceReplica: ApplicationsService;

    const adminPanelRedirectUris = ['http://test-admin.com'];
    const blockExplorerRedirectUris = ['http://test-explorer.com'];
    const testSelfOrigin = 'http://test-api.local';
    const cacheDuration = 1000;

    beforeEach<Fixture>(async ({ db }) => {
        vi.useFakeTimers();
        const repos = new Repositories(db);
        const opts = {
            adminPanelRedirectUris,
            blockExplorerRedirectUris,
            swaggerDocsRedirectUris: [],
            cacheDurationMs: cacheDuration
        };
        service = new ApplicationsService(repos, opts);
        otherServiceReplica = new ApplicationsService(repos, opts);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    // ----------------------------------------------------------------
    // Perpetual apps
    // ----------------------------------------------------------------

    it('searchPaginated returns perpetual apps', async () => {
        const res = await service.searchPaginated({ limit: 10, offset: 0 });

        expect(res.items).toHaveLength(4);
        const blockExplorer = res.items.find((app) => app.id === 'block-explorer');
        expect(blockExplorer).toEqual({
            id: 'block-explorer',
            name: 'Block Explorer',
            oauthClientId: 'block-explorer',
            oauthRedirectUris: blockExplorerRedirectUris,
            origin: null,
            isPublic: true,
            description:
                'Private and access-controlled blockchain explorer provides all the information to deep dive into transactions, blocks, contracts, and much more.',
            imageUrl: null,
            createdAt: new Date(0),
            updatedAt: new Date(0)
        });
        const adminPanel = res.items.find((app) => app.id === 'admin-panel');
        expect(adminPanel).toEqual({
            id: 'admin-panel',
            name: 'Admin Panel',
            oauthClientId: 'admin-panel',
            oauthRedirectUris: adminPanelRedirectUris,
            origin: null,
            isPublic: true,
            description:
                'Centralized administration dashboard for managing users, applications, permissions, and network configuration.',
            imageUrl: null,
            createdAt: new Date(0),
            updatedAt: new Date(0)
        });
        expect(res.pagination).toEqual({
            currentPage: 1,
            limit: 10,
            offset: 0,
            totalItems: 4,
            totalPages: 1
        });
    });

    it('pagination mixes perpetual apps then DB apps', async () => {
        const arr = new Array(20).fill(null).map((_, i) => i + 1);

        for (const index of arr) {
            const date = new Date(2000, 1, 1, index);
            vi.setSystemTime(date);
            await service.create({
                name: `app ${index}`,
                oauthRedirectUris: [`http://app-${index}.com`]
            });
        }

        const res = await service.searchPaginated({ limit: 10, offset: 0 }).then((r) => r.items);
        expect(res.map((app) => app.name)).toEqual([
            'Block Explorer',
            'Admin Panel',
            'Proxy CLI',
            'Swagger Docs',
            'app 1',
            'app 2',
            'app 3',
            'app 4',
            'app 5',
            'app 6'
        ]);

        const res2 = await service.searchPaginated({ limit: 10, offset: 1 }).then((r) => r.items);
        expect(res2.map((app) => app.name)).toEqual([
            'Admin Panel',
            'Proxy CLI',
            'Swagger Docs',
            'app 1',
            'app 2',
            'app 3',
            'app 4',
            'app 5',
            'app 6',
            'app 7'
        ]);

        const res3 = await service.searchPaginated({ limit: 10, offset: 4 }).then((r) => r.items);
        expect(res3.map((app) => app.name)).toEqual([
            'app 1',
            'app 2',
            'app 3',
            'app 4',
            'app 5',
            'app 6',
            'app 7',
            'app 8',
            'app 9',
            'app 10'
        ]);

        const res4 = await service.searchPaginated({ limit: 10, offset: 6 }).then((r) => r.items);
        expect(res4.map((app) => app.name)).toEqual([
            'app 3',
            'app 4',
            'app 5',
            'app 6',
            'app 7',
            'app 8',
            'app 9',
            'app 10',
            'app 11',
            'app 12'
        ]);
    });

    it('#getById returns a perpetual app', async () => {
        const adminPanel = await service.getById('admin-panel');
        expect(adminPanel).toEqual({
            id: 'admin-panel',
            name: 'Admin Panel',
            oauthClientId: 'admin-panel',
            oauthRedirectUris: adminPanelRedirectUris,
            origin: null,
            isPublic: true,
            description:
                'Centralized administration dashboard for managing users, applications, permissions, and network configuration.',
            imageUrl: null,
            createdAt: new Date(0),
            updatedAt: new Date(0)
        });
    });

    it('#getByOauthClientId returns a perpetual app', async () => {
        const adminPanel = await service.getByOauthClientId('admin-panel');
        expect(adminPanel).toMatchObject({
            oauthClientId: 'admin-panel',
            oauthRedirectUris: adminPanelRedirectUris,
            name: 'Admin Panel'
        });
    });

    it('#getByOauthClientId derives swagger-docs redirect URIs from the caller origin', async () => {
        const withOrigin = await service.getByOauthClientId('swagger-docs', testSelfOrigin);
        expect(withOrigin).toMatchObject({
            oauthClientId: 'swagger-docs',
            oauthRedirectUris: [`${testSelfOrigin}/docs/callback`]
        });

        const withoutOrigin = await service.getByOauthClientId('swagger-docs');
        expect(withoutOrigin.oauthRedirectUris).toEqual([]);
    });

    it('#getByOauthClientId unions configured swagger-docs redirect URIs with the caller origin, deduped', async ({
        db
    }: Fixture) => {
        const vanityUri = 'https://api.vanity.example.com/docs/callback';
        const configured = new ApplicationsService(new Repositories(db), {
            adminPanelRedirectUris,
            blockExplorerRedirectUris,
            swaggerDocsRedirectUris: [vanityUri, `${testSelfOrigin}/docs/callback`],
            cacheDurationMs: cacheDuration
        });

        // Deduped: the request-derived URI already appears in the configured list.
        const withOrigin = await configured.getByOauthClientId('swagger-docs', testSelfOrigin);
        expect(withOrigin.oauthRedirectUris).toEqual([vanityUri, `${testSelfOrigin}/docs/callback`]);

        const withoutOrigin = await configured.getByOauthClientId('swagger-docs');
        expect(withoutOrigin.oauthRedirectUris).toEqual([vanityUri, `${testSelfOrigin}/docs/callback`]);
    });

    it('#delete throws when trying to remove a perpetual app', async () => {
        await expect(service.delete('admin-panel')).rejects.toThrow('Perpetual apps cannot be removed');
    });

    it('#searchPublicPaginated returns only public perpetual apps', async () => {
        const res = await service.searchPublicPaginated({ limit: 10, offset: 0 });

        expect(res.items).toHaveLength(2);
        expect(res.items.map((app) => app.id)).toEqual(['block-explorer', 'admin-panel']);
        expect(res.pagination.totalItems).toEqual(2);
    });

    it('#searchPublicPaginated includes public DB apps', async () => {
        await service.create({
            name: 'public app',
            oauthRedirectUris: ['http://redirect.com'],
            origin: 'http://example.com',
            isPublic: true
        });
        await service.create({ name: 'private app', oauthRedirectUris: ['http://redirect2.com'], isPublic: false });

        const res = await service.searchPublicPaginated({ limit: 10, offset: 0 });

        expect(res.items).toHaveLength(3);
        expect(res.items.map((app) => app.name)).toEqual(['Block Explorer', 'Admin Panel', 'public app']);
    });

    it('#searchPublicPaginated paginates correctly', async () => {
        for (let i = 1; i <= 5; i++) {
            vi.setSystemTime(new Date(2000, 1, 1, i));
            await service.create({
                name: `public app ${i}`,
                oauthRedirectUris: [`http://app-${i}.com`],
                isPublic: true
            });
        }

        const page1 = await service.searchPublicPaginated({ limit: 3, offset: 0 });
        expect(page1.items.map((app) => app.name)).toEqual(['Block Explorer', 'Admin Panel', 'public app 1']);
        expect(page1.pagination.totalItems).toEqual(7);
        expect(page1.pagination.totalPages).toEqual(3);

        const page2 = await service.searchPublicPaginated({ limit: 3, offset: 3 });
        expect(page2.items.map((app) => app.name)).toEqual(['public app 2', 'public app 3', 'public app 4']);

        const page3 = await service.searchPublicPaginated({ limit: 3, offset: 6 });
        expect(page3.items.map((app) => app.name)).toEqual(['public app 5']);
    });

    // ----------------------------------------------------------------
    // Create
    // ----------------------------------------------------------------

    it('#create generates an oauthClientId', async () => {
        const app = await service.create({ name: 'app 1', oauthRedirectUris: ['http://app1.com'] });

        expect(app.oauthClientId).toHaveLength(16);
        expect(app.oauthClientId).toMatch(/^[a-zA-Z0-9]+$/);
    });

    it('#create generates a different oauthClientId per application', async () => {
        const names = Array.from({ length: 32 }, (_, i) => `app-${i}`);

        const apps = await Promise.all(
            names.map((name) => service.create({ name, oauthRedirectUris: [`http://${name}.com`] }))
        );

        expect(new Set(apps.map((a) => a.oauthClientId)).size).toEqual(32);
    });

    // ----------------------------------------------------------------
    // OAuth client ID cache
    // ----------------------------------------------------------------

    it('#getByOauthClientId serves the cached entry within the TTL', async () => {
        const app = await service.create({ name: 'app 1', oauthRedirectUris: ['http://old.com'] });

        // Warm the cache, then change the DB behind the service's back
        // (simulates another replica handling the update).
        expect(await service.getByOauthClientId(app.oauthClientId)).toMatchObject({
            oauthRedirectUris: ['http://old.com']
        });
        await otherServiceReplica.update(app.id, {
            name: 'app 1',
            oauthRedirectUris: ['http://new.com'],
            origin: null,
            description: null,
            imageUrl: null,
            isPublic: false
        });

        vi.setSystemTime(Date.now() + cacheDuration - 1);

        expect(await service.getByOauthClientId(app.oauthClientId)).toMatchObject({
            oauthRedirectUris: ['http://old.com']
        });
    });

    it('#getByOauthClientId refreshes from the DB after the TTL', async () => {
        const app = await service.create({ name: 'app 1', oauthRedirectUris: ['http://old.com'] });

        expect(await service.getByOauthClientId(app.oauthClientId)).toMatchObject({
            oauthRedirectUris: ['http://old.com']
        });
        await otherServiceReplica.update(app.id, {
            name: 'app 1',
            oauthRedirectUris: ['http://new.com'],
            origin: null,
            description: null,
            imageUrl: null,
            isPublic: false
        });

        vi.setSystemTime(Date.now() + cacheDuration + 1);

        expect(await service.getByOauthClientId(app.oauthClientId)).toMatchObject({
            oauthRedirectUris: ['http://new.com']
        });
    });

    it('#update invalidates the client ID cache on the same instance', async () => {
        const app = await service.create({ name: 'app 1', oauthRedirectUris: ['http://old.com'] });

        expect(await service.getByOauthClientId(app.oauthClientId)).toMatchObject({
            oauthRedirectUris: ['http://old.com']
        });

        await service.update(app.id, {
            name: 'app 1',
            oauthRedirectUris: ['http://new.com'],
            origin: null,
            description: null,
            imageUrl: null,
            isPublic: false
        });

        // No time advance — the update must be visible immediately.
        expect(await service.getByOauthClientId(app.oauthClientId)).toMatchObject({
            oauthRedirectUris: ['http://new.com']
        });
    });

    // ----------------------------------------------------------------
    // Origin cache
    // ----------------------------------------------------------------

    it('#allAppOrigins refreshes after TTL', async () => {
        const domain = 'http://localhost:30303';
        await service.create({ name: 'app 1', oauthRedirectUris: ['http://redirect.com'], origin: domain });

        vi.setSystemTime(Date.now() + cacheDuration + 1);

        expect(await service.allAppOrigins()).toEqual([domain]);
    });

    it('#allAppOrigins does not include apps without origin', async () => {
        const domain = 'http://localhost:30303';
        await service.create({ name: 'app 1', oauthRedirectUris: ['http://redirect.com'], origin: domain });
        await service.create({ name: 'app 2', oauthRedirectUris: ['http://redirect2.com'] });

        vi.setSystemTime(Date.now() + cacheDuration + 1);

        expect(await service.allAppOrigins()).toEqual([domain]);
    });

    it('#create invalidates origin cache', async () => {
        await service.create({
            name: 'app 1',
            oauthRedirectUris: ['http://app1.com'],
            origin: 'http://origin1.com'
        });

        // Warm the cache within the TTL window.
        expect(await service.allAppOrigins()).toEqual(['http://origin1.com']);

        await service.create({
            name: 'app 2',
            oauthRedirectUris: ['http://app2.com'],
            origin: 'http://origin2.com'
        });

        // No time advance — new origin must be visible immediately.
        expect(await service.allAppOrigins()).toEqual(
            expect.arrayContaining(['http://origin1.com', 'http://origin2.com'])
        );
    });

    it('#update invalidates origin cache', async () => {
        const app = await service.create({
            name: 'some app',
            oauthRedirectUris: ['http://some-app.com'],
            origin: 'http://origin1.com'
        });

        // Warm the cache with the original origin within the TTL window.
        expect(await service.allAppOrigins()).toEqual(['http://origin1.com']);

        await service.update(app.id, {
            name: 'new name',
            oauthRedirectUris: ['http://new-1.com'],
            origin: 'http://origin2.com',
            description: null,
            imageUrl: null,
            isPublic: false
        });

        // No time advance — updated origin must be visible immediately.
        expect(await service.allAppOrigins()).toEqual(['http://origin2.com']);
    });

    it('#update invalidates origin cache when origin is unchanged', async () => {
        const origin = 'http://origin.com';
        const app = await service.create({
            name: 'some app',
            oauthRedirectUris: ['http://some-app.com'],
            origin
        });

        expect(await service.allAppOrigins()).toEqual([origin]);

        await service.update(app.id, {
            name: 'new name',
            oauthRedirectUris: ['http://new-1.com'],
            origin,
            description: null,
            imageUrl: null,
            isPublic: false
        });

        expect(await service.allAppOrigins()).toEqual([origin]);
    });

    it('#delete invalidates origin cache', async () => {
        const origin = 'http://origin.com';
        const app = await service.create({ name: 'some app', oauthRedirectUris: [], origin });

        // Warm the cache within the TTL window.
        expect(await service.allAppOrigins()).toEqual([origin]);

        await service.delete(app.id);

        // No time advance — deletion must be visible immediately.
        expect(await service.allAppOrigins()).toEqual([]);
    });
});
