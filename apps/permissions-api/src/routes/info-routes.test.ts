import { defineFeaturePermission } from '@repo/api-kit';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { infoRoutes } from './info-routes';

describe('GET /info', () => {
    it('lists the permissions the registered features declared', async () => {
        const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.register(infoRoutes, {
            prefix: '/info',
            policyEnabled: false,
            features: ['example-feature'],
            featurePermissions: [
                defineFeaturePermission('example_feature_access', {
                    orgGrantable: true,
                    description: 'Example feature access'
                }),
                defineFeaturePermission('example_feature_operate', { orgGrantable: false })
            ],
            multiOrgEnabled: false,
            orgRoutingByDomain: false,
            passkeyRegistrationEnabled: false
        });

        const response = await app.inject({ method: 'GET', url: '/info' });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            features: ['example-feature'],
            featurePermissions: [
                { name: 'example_feature_access', orgGrantable: true, description: 'Example feature access' },
                { name: 'example_feature_operate', orgGrantable: false }
            ]
        });
        await app.close();
    });
});
