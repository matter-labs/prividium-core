import cors, { type FastifyCorsOptions } from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyContextConfig, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { AppConfig, FastifyServer } from './build-app';

declare module 'fastify' {
    // This is needed to do per-route cors rule overriding
    interface FastifyContextConfig {
        cors?: FastifyCorsOptions | boolean;
    }
}

interface AppOriginsSource {
    allAppOrigins(): Promise<string[]>;
}

export function registerCorsMiddleware(app: FastifyInstance, validOrigins: string[], appsRepo: AppOriginsSource) {
    if (validOrigins) {
        app.register(cors, {
            origin: (origin, cb) => {
                if (origin === undefined) {
                    // origin undefined means request not affected by CORS
                    cb(null, true);
                    return;
                }

                if (validOrigins.includes(origin)) {
                    cb(null, true);
                    return;
                }

                appsRepo.allAppOrigins().then(
                    (appOrigins) => {
                        cb(null, appOrigins.includes(origin));
                        return;
                    },
                    (e: Error) => cb(e, false)
                );
            },
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Step-Up-Proof'],
            credentials: true
        });
    }
}

/**
 * Swagger UI's sample generator crashes on `contentEncoding: base64url`
 * (swagger-api/swagger-ui#10613), which Zod v4 emits for z.base64url(),
 * leaving the affected endpoints' parameters unrendered on /docs (#1564).
 * Strip the offending key; runtime validation is unaffected. Still unfixed as of
 * @fastify/swagger-ui 6.1.1 — verify in a browser before removing, the crash is
 * console-only and every endpoint still renders.
 */
function stripBase64urlEncoding(schema: unknown): void {
    if (Array.isArray(schema)) {
        for (const item of schema) stripBase64urlEncoding(item);
        return;
    }
    if (schema === null || typeof schema !== 'object') return;
    const record = schema as Record<string, unknown>;
    if (record.contentEncoding === 'base64url') delete record.contentEncoding;
    for (const value of Object.values(record)) stripBase64urlEncoding(value);
}

type SwaggerTransformInput = Parameters<typeof jsonSchemaTransform>[0] & {
    route?: { config?: FastifyContextConfig };
};

export const swaggerSchemaTransform = (input: SwaggerTransformInput): ReturnType<typeof jsonSchemaTransform> => {
    const result = jsonSchemaTransform(input);
    stripBase64urlEncoding(result.schema);
    // Marks the application surface in the spec so the authn coverage guard can pin the allowlist.
    if (input.route?.config?.allowApplicationSession === true) {
        result.schema = Object.assign(result.schema ?? {}, { 'x-application-session': true });
    }
    if (input.route?.config?.allowRpcSession === true) {
        result.schema = Object.assign(result.schema ?? {}, { 'x-rpc-session': true });
    }
    return result;
};

export function registerSwaggerSpec(app: FastifyServer, config: Pick<AppConfig, 'brandName' | 'version'>): void {
    app.register(swagger, {
        openapi: {
            openapi: '3.1.0',
            info: {
                title: `${config.brandName} Permissions API`,
                description: `API for managing user permissions, roles and access control in the ${config.brandName} ecosystem`,
                version: config.version
            },
            servers: [
                {
                    url: '/api',
                    description: 'API base path'
                }
            ],
            tags: [
                { name: 'users', description: 'User management endpoints' },
                { name: 'roles', description: 'Role management endpoints' },
                { name: 'check', description: 'Permission checking endpoints' },
                { name: 'contract-permissions', description: 'Contract permission management endpoints' },
                { name: 'contracts', description: 'Contract management endpoints' }
            ]
        },
        transform: swaggerSchemaTransform
    });
}

export type SwaggerUiRequestHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerSwaggerUi(app: FastifyServer, onRequest: SwaggerUiRequestHook): void {
    app.register(swaggerUi, {
        routePrefix: '/docs',
        uiConfig: {
            docExpansion: 'list',
            deepLinking: false,
            displayRequestDuration: true,
            filter: true
        },
        theme: {
            css: [
                {
                    filename: 'hide-topbar.css',
                    content: '.swagger-ui .topbar { display: none !important; }'
                }
            ]
        },
        uiHooks: {
            onRequest
        }
    });
}
