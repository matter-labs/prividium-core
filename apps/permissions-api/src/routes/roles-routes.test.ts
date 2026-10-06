import { defineFeaturePermission } from '@repo/api-kit';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { afterEach, describe, expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import type { FastifyServer } from '../build-app';
import { type DB, Repositories } from '../db';
import { errorHandler } from '../error-handler';
import { CORE_PERMISSION_CATALOG, PermissionCatalog } from '../permissions/permission-catalog';
import { rolesRoutes } from './roles-routes';

const EXAMPLE_ACCESS = defineFeaturePermission('example_feature_access', {
    feature: 'example-feature',
    orgGrantable: true
});

const apps: FastifyServer[] = [];

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(db: DB, permissionCatalog: PermissionCatalog): Promise<FastifyServer> {
    const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
    apps.push(app);
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(errorHandler);
    const repos = new Repositories(db);
    app.addHook('onRequest', async (request) => {
        request.repos = repos;
    });
    app.register(rolesRoutes, { prefix: '/roles', multiOrgEnabled: false, permissionCatalog });
    await app.ready();
    return app;
}

describe('rolesRoutes with feature permissions', () => {
    it('creates a role holding a registered feature permission', async ({ db }) => {
        const app = await appWith(db, new PermissionCatalog([EXAMPLE_ACCESS]));

        const response = await app.inject({
            method: 'POST',
            url: '/roles',
            payload: { roleName: 'feature', systemPermissions: [EXAMPLE_ACCESS.name] }
        });

        expect(response.statusCode).toBe(201);
        expect(response.json().systemPermissions).toEqual([EXAMPLE_ACCESS.name]);
    });

    it('answers 400 for a feature permission this deployment does not register', async ({ db }) => {
        const app = await appWith(db, CORE_PERMISSION_CATALOG);

        const response = await app.inject({
            method: 'POST',
            url: '/roles',
            payload: { roleName: 'feature', systemPermissions: [EXAMPLE_ACCESS.name] }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error.message).toBe('Unknown system permissions: example_feature_access');
    });

    it('reads a role whose feature was switched off and saves it only without that permission', async ({ db }) => {
        const role = await new Repositories(db).roles.create(
            { roleName: 'feature', systemPermissions: ['admin_read', EXAMPLE_ACCESS.name] },
            { catalog: new PermissionCatalog([EXAMPLE_ACCESS]) }
        );
        const app = await appWith(db, CORE_PERMISSION_CATALOG);

        const read = await app.inject({ method: 'GET', url: `/roles/${role.id}` });
        expect(read.statusCode).toBe(200);
        expect(read.json().systemPermissions).toEqual(['admin_read', EXAMPLE_ACCESS.name]);

        const list = await app.inject({ method: 'GET', url: '/roles' });
        expect(list.statusCode).toBe(200);

        const kept = await app.inject({
            method: 'PUT',
            url: `/roles/${role.id}`,
            payload: { roleName: 'renamed', systemPermissions: read.json().systemPermissions }
        });
        expect(kept.statusCode).toBe(400);
        expect(kept.json().error.message).toBe('Unknown system permissions: example_feature_access');

        const dropped = await app.inject({
            method: 'PUT',
            url: `/roles/${role.id}`,
            payload: { roleName: 'renamed', systemPermissions: ['admin_read'] }
        });
        expect(dropped.statusCode).toBe(200);
        expect(dropped.json().systemPermissions).toEqual(['admin_read']);
    });
});
