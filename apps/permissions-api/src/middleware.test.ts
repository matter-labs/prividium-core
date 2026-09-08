import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from './build-app';
import { registerSwaggerSpec, swaggerSchemaTransform } from './middleware';
import { InvalidateResponseSchema, PersonalRpcTokenResponseSchema } from './routes/schemas/wallets';
import { WebAuthnAuthenticationResponseSchema } from './utils/schemas/webauthn';

function transformRoute(schema: Record<string, unknown>) {
    return swaggerSchemaTransform({
        schema,
        url: '/test',
        route: {},
        openapiObject: { openapi: '3.1.0' }
        // biome-ignore lint/suspicious/noExplicitAny: partial fastify route input is enough for the transform
    } as any);
}

const minimalConfig: Pick<AppConfig, 'brandName' | 'version'> = {
    brandName: 'AcmeCorp',
    version: '1.0.0'
};

describe('swaggerSchemaTransform', () => {
    it('strips contentEncoding base64url that crashes Swagger UI (swagger-api/swagger-ui#10613)', () => {
        const { schema } = transformRoute({
            body: WebAuthnAuthenticationResponseSchema,
            response: { 200: InvalidateResponseSchema, 201: PersonalRpcTokenResponseSchema }
        });

        expect(JSON.stringify(schema)).not.toContain('"contentEncoding":"base64url"');
    });

    it('keeps the base64url fields and their other annotations intact', () => {
        const { schema } = transformRoute({ response: { 200: PersonalRpcTokenResponseSchema } });

        // biome-ignore lint/suspicious/noExplicitAny: navigating generated JSON Schema output
        const token = (schema as any).response['200'].properties.token;
        expect(token).toEqual({
            type: 'string',
            format: 'base64url',
            pattern: '^[A-Za-z0-9_-]*$'
        });
        // biome-ignore lint/suspicious/noExplicitAny: navigating generated JSON Schema output
        expect((schema as any).response['200'].required).toContain('token');
    });
});

describe('registerSwaggerSpec', () => {
    it('sets OpenAPI info.title to "{brandName} Permissions API"', async () => {
        const app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        registerSwaggerSpec(app as never, minimalConfig);
        await app.ready();

        const spec = app.swagger();
        expect(spec.info.title).toBe('AcmeCorp Permissions API');

        await app.close();
    });

    it('includes brandName in OpenAPI info.description', async () => {
        const app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        registerSwaggerSpec(app as never, minimalConfig);
        await app.ready();

        const spec = app.swagger();
        expect(spec.info.description).toContain('AcmeCorp');

        await app.close();
    });
});
