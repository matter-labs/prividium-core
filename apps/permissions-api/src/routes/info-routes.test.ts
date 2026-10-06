import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { infoRoutes } from './info-routes';

describe('GET /info', () => {
    it('lists the registered features without the permissions they declare', async () => {
        const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.register(infoRoutes, {
            prefix: '/info',
            policyEnabled: false,
            features: ['example-feature'],
            multiOrgEnabled: false,
            orgRoutingByDomain: false,
            passkeyRegistrationEnabled: false
        });

        const response = await app.inject({ method: 'GET', url: '/info' });

        expect(response.statusCode).toBe(200);
        expect(response.json().features).toEqual(['example-feature']);
        expect(response.json()).not.toHaveProperty('featurePermissions');
        await app.close();
    });
});
