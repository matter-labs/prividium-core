import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { EntityNotFound } from '../utils/error-types';
import { ApplicationsRepository } from './applications-repository';

describe('ApplicationsRepository', () => {
    let repository: ApplicationsRepository;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new ApplicationsRepository(db);
    });

    it('can create a new application', async () => {
        const redirectUri = 'http://redirect.com';
        const app = await repository.create({
            name: 'app 1',
            oauthClientId: 'client-1',
            oauthRedirectUris: [redirectUri]
        });

        expect(app.name).toBe('app 1');
        expect(app.oauthClientId).toBe('client-1');
        expect(app.oauthRedirectUris).toEqual([redirectUri]);
    });

    it('#getById returns the created app', async () => {
        const app = await repository.create({
            name: 'some app',
            oauthClientId: 'client-1',
            oauthRedirectUris: ['http://some-app.com']
        });
        const retrieved = await repository.getById(app.id);
        expect(retrieved).toEqual(app);
    });

    it('#getById throws EntityNotFound when app does not exist', async () => {
        await expect(repository.getById('does not exist')).rejects.toThrow(
            new EntityNotFound('Application', { id: 'does not exist' })
        );
    });

    it('#getByOauthClientId returns the matching app', async () => {
        const app = await repository.create({
            name: 'some app',
            oauthClientId: 'client-1',
            oauthRedirectUris: ['http://some-app.com']
        });
        const retrieved = await repository.getByOauthClientId(app.oauthClientId);
        expect(retrieved).toEqual({
            name: app.name,
            oauthClientId: app.oauthClientId,
            oauthRedirectUris: app.oauthRedirectUris
        });
    });

    it('#getByOauthClientId throws EntityNotFound when not found', async () => {
        await expect(repository.getByOauthClientId('nonexistent')).rejects.toThrow(EntityNotFound);
    });

    it('#update changes fields and returns updated app', async () => {
        const app = await repository.create({
            name: 'some app',
            oauthClientId: 'client-1',
            oauthRedirectUris: ['http://some-app.com'],
            origin: 'http://origin1.com'
        });

        const updated = await repository.updateById(app.id, {
            name: 'new name',
            oauthRedirectUris: ['http://new-1.com', 'http://new-2.com'],
            origin: 'http://new-origin.com'
        });

        expect(updated.name).toBe('new name');
        expect(updated.oauthRedirectUris).toEqual(['http://new-1.com', 'http://new-2.com']);
        expect(updated.origin).toBe('http://new-origin.com');
        expect(updated.id).toBe(app.id);
    });

    it('#update advances updatedAt', async () => {
        const app = await repository.create({
            name: 'some app',
            oauthClientId: 'client-1',
            oauthRedirectUris: ['http://some-app.com']
        });

        await new Promise((r) => setTimeout(r, 50));

        const updated = await repository.updateById(app.id, {
            name: 'new name',
            oauthRedirectUris: app.oauthRedirectUris
        });

        expect(updated.updatedAt.getTime()).toBeGreaterThan(app.updatedAt.getTime());
    });

    it('#update throws EntityNotFound when app does not exist', async () => {
        await expect(repository.updateById('doesnotexist', { name: 'x', oauthRedirectUris: [] })).rejects.toThrow(
            EntityNotFound
        );
    });

    it('#delete removes the app and returns it', async () => {
        const app = await repository.create({
            name: 'some app',
            oauthClientId: 'client-1',
            oauthRedirectUris: []
        });

        const deleted = await repository.deleteById(app.id);
        expect(deleted.id).toBe(app.id);

        await expect(repository.getById(app.id)).rejects.toThrow(EntityNotFound);
    });

    it('#delete throws EntityNotFound when app does not exist', async () => {
        await expect(repository.deleteById('doesnotexist')).rejects.toThrow(EntityNotFound);
    });

    it('#findPaginated returns DB apps without perpetual', async () => {
        const app = await repository.create({ name: 'app A', oauthClientId: 'client-1', oauthRedirectUris: [] });
        const res = await repository.findPaginated({ limit: 10, offset: 0 });
        expect(res.items).toHaveLength(1);
        expect(res.items[0]?.id).toBe(app.id);
        expect(res.pagination.totalItems).toBe(1);
    });

    it('#searchPublicPaginated returns only public DB apps', async () => {
        await repository.create({
            name: 'public app',
            oauthClientId: 'client-1',
            oauthRedirectUris: [],
            isPublic: true
        });
        await repository.create({
            name: 'private app',
            oauthClientId: 'client-2',
            oauthRedirectUris: [],
            isPublic: false
        });

        const res = await repository.searchPublicPaginated({ limit: 10, offset: 0 });
        expect(res.items).toHaveLength(1);
        expect(res.items[0]?.name).toBe('public app');
    });

    it('#allAppOrigins returns only apps with origins', async () => {
        await repository.create({
            name: 'app with origin',
            oauthClientId: 'client-1',
            oauthRedirectUris: [],
            origin: 'http://example.com'
        });
        await repository.create({ name: 'app without origin', oauthClientId: 'client-2', oauthRedirectUris: [] });

        const origins = await repository.allAppOrigins();
        expect(origins).toEqual(['http://example.com']);
    });
});
