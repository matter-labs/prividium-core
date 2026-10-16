import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { describe, expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { errorHandler } from '../error-handler';
import { ApplicationsService } from '../services/applications-service';
import { publicApplicationsRoutes } from './public-applications-routes';

describe('GET /oauth-clients/:oauthClientId', () => {
    it('answers 404 for every Object.prototype property name', async ({ db }) => {
        const applicationsService = new ApplicationsService(new Repositories(db), {
            adminPanelRedirectUris: [],
            blockExplorerRedirectUris: [],
            swaggerDocsRedirectUris: [],
            cacheDurationMs: 1000
        });
        const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.setErrorHandler(errorHandler);
        app.register(publicApplicationsRoutes, { prefix: '/oauth-clients', applicationsService });

        const names = Object.getOwnPropertyNames(Object.prototype);
        const statuses: [string, number][] = [];
        for (const name of names) {
            const response = await app.inject({ method: 'GET', url: `/oauth-clients/${name}` });
            statuses.push([name, response.statusCode]);
        }
        await app.close();

        expect(statuses).toEqual(names.map((name) => [name, 404]));
    });
});
