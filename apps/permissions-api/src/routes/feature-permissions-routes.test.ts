import { defineFeaturePermission } from '@repo/api-kit';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { afterEach, describe, expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import type { FastifyServer } from '../build-app';
import { type DB, Repositories } from '../db';
import { errorHandler } from '../error-handler';
import type { SessionsAuthValidator } from '../middleware/sessions-auth';
import { PermissionCatalog } from '../permissions/permission-catalog';
import { featurePermissionsRoutes, orgFeaturePermissionsRoutes } from './feature-permissions-routes';

const catalog = new PermissionCatalog([
    defineFeaturePermission('example_feature_access', { feature: 'example-feature', orgGrantable: true }),
    defineFeaturePermission('example_feature_operate', { feature: 'example-feature', orgGrantable: false }),
    defineFeaturePermission('other_feature_access', { feature: 'other-feature', orgGrantable: true })
]);

type Caller = {
    organizationId: string | null;
    roles: { systemPermissions: string[]; organizationId: string | null }[];
};

const apps: FastifyServer[] = [];

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(db: DB, register: (app: FastifyServer) => void): Promise<FastifyServer> {
    const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
    apps.push(app);
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(errorHandler);
    const repos = new Repositories(db);
    app.addHook('onRequest', async (request) => {
        request.repos = repos;
    });
    register(app);
    await app.ready();
    return app;
}

function authenticatedAs(caller: Caller): SessionsAuthValidator {
    const user = { id: 'caller', ...caller };
    return {
        buildHook: () => async (request: { auth: unknown }) => {
            request.auth = { type: 'user', currentUser: () => user };
        }
    } as unknown as SessionsAuthValidator;
}

describe('GET /feature-permissions', () => {
    it('lists every declared permission and whether its feature is enabled', async ({ db }) => {
        const app = await appWith(db, (app) =>
            app.register(featurePermissionsRoutes, {
                prefix: '/feature-permissions',
                permissionCatalog: catalog,
                featureNames: ['example-feature']
            })
        );

        const response = await app.inject({ method: 'GET', url: '/feature-permissions' });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            items: [
                { name: 'example_feature_access', feature: 'example-feature', orgGrantable: true, enabled: true },
                { name: 'example_feature_operate', feature: 'example-feature', orgGrantable: false, enabled: true },
                { name: 'other_feature_access', feature: 'other-feature', orgGrantable: true, enabled: false }
            ]
        });
    });
});

describe('GET /organizations/:id/feature-permissions', () => {
    const orgApp = (db: DB, caller: Caller) =>
        appWith(db, (app) =>
            app.register(orgFeaturePermissionsRoutes, {
                prefix: '/organizations',
                sessionAuthValidator: authenticatedAs(caller),
                permissionCatalog: catalog,
                featureNames: ['example-feature']
            })
        );

    it('lists only the org-grantable permissions to an admin of the organization', async ({ db }) => {
        const org = await new Repositories(db).organizations.create({ name: 'Org', defaultRoles: [] });
        const app = await orgApp(db, {
            organizationId: org.id,
            roles: [{ systemPermissions: ['admin_read'], organizationId: org.id }]
        });

        const response = await app.inject({ method: 'GET', url: `/organizations/${org.id}/feature-permissions` });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            items: [
                { name: 'example_feature_access', feature: 'example-feature', orgGrantable: true, enabled: true },
                { name: 'other_feature_access', feature: 'other-feature', orgGrantable: true, enabled: false }
            ]
        });
    });

    it('admits a zone operator', async ({ db }) => {
        const org = await new Repositories(db).organizations.create({ name: 'Org', defaultRoles: [] });
        const app = await orgApp(db, {
            organizationId: null,
            roles: [{ systemPermissions: ['admin_read'], organizationId: null }]
        });

        const response = await app.inject({ method: 'GET', url: `/organizations/${org.id}/feature-permissions` });

        expect(response.statusCode).toBe(200);
    });

    it('answers 403 to an admin of another organization', async ({ db }) => {
        const repos = new Repositories(db);
        const org = await repos.organizations.create({ name: 'Org', defaultRoles: [] });
        const peer = await repos.organizations.create({ name: 'Peer', defaultRoles: [] });
        const app = await orgApp(db, {
            organizationId: peer.id,
            roles: [{ systemPermissions: ['admin_read'], organizationId: peer.id }]
        });

        const response = await app.inject({ method: 'GET', url: `/organizations/${org.id}/feature-permissions` });

        expect(response.statusCode).toBe(403);
    });

    it('answers 403 to a member of the organization who is not its admin', async ({ db }) => {
        const org = await new Repositories(db).organizations.create({ name: 'Org', defaultRoles: [] });
        const app = await orgApp(db, {
            organizationId: org.id,
            roles: [{ systemPermissions: ['org_rpc_access'], organizationId: org.id }]
        });

        const response = await app.inject({ method: 'GET', url: `/organizations/${org.id}/feature-permissions` });

        expect(response.statusCode).toBe(403);
    });
});
