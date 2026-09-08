import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import { RateLimitError } from '../utils/error-types';
import {
    actorKeyGenerator,
    isTrustedActor,
    registerGlobalRateLimit,
    registerRateLimitForScope,
    userKeyGenerator
} from './rate-limit-middleware';

function testErrorHandler(
    error: Error & { statusCode?: number; code?: string },
    _req: FastifyRequest,
    reply: FastifyReply
) {
    if (error instanceof RateLimitError) {
        return reply.status(error.statusCode).send({
            error: { code: error.code, message: error.message }
        });
    }
    return reply.status(error.statusCode || 500).send({ error: { message: error.message } });
}

describe('rate-limit-middleware', () => {
    describe('registerRateLimitForScope', () => {
        it('should rate limit requests after max is exceeded', async () => {
            const app = Fastify();

            await app.register(rateLimit, {
                max: 2,
                timeWindow: 60000
            });

            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            await app.ready();

            const response1 = await app.inject({ method: 'GET', url: '/test' });
            expect(response1.statusCode).toBe(200);

            const response2 = await app.inject({ method: 'GET', url: '/test' });
            expect(response2.statusCode).toBe(200);

            // Third request should be rate limited
            const response3 = await app.inject({ method: 'GET', url: '/test' });
            expect(response3.statusCode).toBe(429);

            await app.close();
        });

        it('should include rate limit headers', async () => {
            const app = Fastify();
            app.setErrorHandler(testErrorHandler);

            await app.register(async (app) => {
                await registerRateLimitForScope(app, {
                    max: 10,
                    timeWindow: 60000
                });

                app.get('/test', async (_req, reply) => {
                    return reply.send({ success: true });
                });
            });

            const response = await app.inject({ method: 'GET', url: '/test' });

            expect(response.headers['x-ratelimit-limit']).toBe('10');
            expect(response.headers['x-ratelimit-remaining']).toBe('9');
            expect(response.headers['x-ratelimit-reset']).toBeDefined();

            await app.close();
        });

        it('should return 429 with proper error format when rate limited', async () => {
            const app = Fastify();
            app.setErrorHandler(testErrorHandler);

            await app.register(async (app) => {
                await registerRateLimitForScope(app, {
                    max: 1,
                    timeWindow: 60000
                });

                app.get('/test', async (_req, reply) => {
                    return reply.send({ success: true });
                });
            });

            const response1 = await app.inject({ method: 'GET', url: '/test' });
            expect(response1.statusCode).toBe(200);

            // Second request should be rate limited with 429
            const response2 = await app.inject({ method: 'GET', url: '/test' });
            expect(response2.statusCode).toBe(429);

            const body = JSON.parse(response2.body);
            expect(body.error.code).toBe('RATE_LIMIT_ERROR');
            expect(body.error.message).toContain('Rate limit exceeded');

            await app.close();
        });
    });

    describe('registerGlobalRateLimit', () => {
        it('should not register rate limiting when disabled', async () => {
            const app = Fastify();

            await app.register(async (app) => {
                registerGlobalRateLimit(
                    app,
                    {
                        enabled: false,
                        auth: { max: 10 },
                        public: { max: 300 },
                        user: { max: 1 },
                        rpc: { max: 1000 },
                        m2m: { max: 1000 },
                        windowMs: 60000
                    },
                    {
                        max: 1,
                        keyGenerator: userKeyGenerator
                    }
                );

                app.get('/test', async (_req, reply) => {
                    return reply.send({ success: true });
                });
            });

            for (let i = 0; i < 5; i++) {
                const response = await app.inject({ method: 'GET', url: '/test' });
                expect(response.statusCode).toBe(200);
            }

            await app.close();
        });
    });

    describe('userKeyGenerator', () => {
        it('should return user-based key when authenticated', () => {
            const mockReq = {
                ip: '192.168.1.1',
                auth: {
                    currentUser: () => ({ id: 'user-123' })
                }
            } as unknown as FastifyRequest;

            expect(userKeyGenerator(mockReq)).toBe('user:user-123');
        });

        it('should return IP-based key when not authenticated', () => {
            const mockReq = {
                ip: '192.168.1.1',
                auth: undefined
            } as unknown as FastifyRequest;

            expect(userKeyGenerator(mockReq)).toBe('ip:192.168.1.1');
        });

        it('should return IP-based key when user ID is undefined', () => {
            const mockReq = {
                ip: '10.0.0.1',
                auth: {
                    currentUser: () => ({ id: undefined })
                }
            } as unknown as FastifyRequest;

            expect(userKeyGenerator(mockReq)).toBe('ip:10.0.0.1');
        });
    });

    describe('actorKeyGenerator', () => {
        it('should return user-based key for user auth type', () => {
            const mockReq = {
                ip: '192.168.1.1',
                auth: {
                    type: 'user',
                    currentUser: () => ({ id: 'user-456' })
                }
            } as unknown as FastifyRequest;

            expect(actorKeyGenerator(mockReq)).toBe('user:user-456');
        });

        it('should return api-key-based key for m2m_app auth type', () => {
            const mockReq = {
                ip: '192.168.1.1',
                auth: {
                    type: 'm2m_app',
                    currentApiKeyId: () => 'key-789'
                }
            } as unknown as FastifyRequest;

            expect(actorKeyGenerator(mockReq)).toBe('m2m:key-789');
        });

        it('should return IP-based key when m2m_app api key id is unavailable', () => {
            const mockReq = {
                ip: '10.0.0.2',
                auth: {
                    type: 'm2m_app',
                    currentApiKeyId: () => {
                        throw new Error('Not authenticated with API key');
                    }
                }
            } as unknown as FastifyRequest;

            expect(actorKeyGenerator(mockReq)).toBe('ip:10.0.0.2');
        });

        it('should return IP-based key for non-user auth', () => {
            const mockReq = {
                ip: '192.168.1.1',
                auth: {
                    type: 'tenant'
                }
            } as unknown as FastifyRequest;

            expect(actorKeyGenerator(mockReq)).toBe('ip:192.168.1.1');
        });

        it('should return IP-based key when currentUser throws', () => {
            const mockReq = {
                ip: '10.0.0.1',
                auth: {
                    type: 'user',
                    currentUser: () => {
                        throw new Error('User not authenticated');
                    }
                }
            } as unknown as FastifyRequest;

            expect(actorKeyGenerator(mockReq)).toBe('ip:10.0.0.1');
        });
    });

    describe('isTrustedActor', () => {
        it('should return false when auth is not present', () => {
            const mockReq = { auth: undefined } as unknown as FastifyRequest;
            expect(isTrustedActor(mockReq)).toBe(false);
        });

        it('should return false when currentUser throws in isTrustedActor', () => {
            const mockReq = {
                auth: {
                    type: 'user',
                    currentUser: () => {
                        throw new Error('User not authenticated');
                    }
                }
            } as unknown as FastifyRequest;

            expect(isTrustedActor(mockReq)).toBe(false);
        });

        it('should return true for tenant auth type', () => {
            const mockReq = {
                auth: { type: 'tenant' }
            } as unknown as FastifyRequest;

            expect(isTrustedActor(mockReq)).toBe(true);
        });

        it('should return true for service auth type', () => {
            const mockReq = {
                auth: { type: 'service' }
            } as unknown as FastifyRequest;

            expect(isTrustedActor(mockReq)).toBe(true);
        });

        it('should return true for user with system permissions', () => {
            const mockReq = {
                auth: {
                    type: 'user',
                    currentUser: () => ({
                        roles: [
                            {
                                roleName: 'rpc-user',
                                systemPermissions: ['full_sequencer_rpc_access'],
                                organizationId: null
                            }
                        ]
                    })
                }
            } as unknown as FastifyRequest;

            expect(isTrustedActor(mockReq)).toBe(true);
        });

        it('should return false for user without system permissions', () => {
            const mockReq = {
                auth: {
                    type: 'user',
                    currentUser: () => ({
                        roles: [{ roleName: 'basic-user', systemPermissions: [] }]
                    })
                }
            } as unknown as FastifyRequest;

            expect(isTrustedActor(mockReq)).toBe(false);
        });

        it('should return false for anonymous auth type', () => {
            const mockReq = {
                auth: { type: 'anonymous' }
            } as unknown as FastifyRequest;

            expect(isTrustedActor(mockReq)).toBe(false);
        });
    });

    describe('rate limiting integration', () => {
        it('should skip rate limiting for trusted actors', async () => {
            const app = Fastify();
            app.setErrorHandler(testErrorHandler);

            await app.register(async (app) => {
                app.addHook('onRequest', async (req) => {
                    (req as unknown as { auth: { type: string } }).auth = {
                        type: 'tenant'
                    };
                });

                registerGlobalRateLimit(
                    app,
                    {
                        enabled: true,
                        auth: { max: 10 },
                        public: { max: 300 },
                        user: { max: 1 },
                        rpc: { max: 1000 },
                        m2m: { max: 1000 },
                        windowMs: 60000
                    },
                    {
                        max: 1,
                        keyGenerator: userKeyGenerator
                    }
                );

                app.get('/test', async (_req, reply) => {
                    return reply.send({ success: true });
                });
            });

            // Tenant should bypass rate limit
            for (let i = 0; i < 5; i++) {
                const response = await app.inject({ method: 'GET', url: '/test' });
                expect(response.statusCode).toBe(200);
            }

            await app.close();
        });

        it('should apply rate limit to non-trusted users', async () => {
            const app = Fastify();

            await app.register(rateLimit, {
                max: 2,
                timeWindow: 60000,
                keyGenerator: () => 'regular-user'
            });

            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            await app.ready();

            const response1 = await app.inject({ method: 'GET', url: '/test' });
            expect(response1.statusCode).toBe(200);

            const response2 = await app.inject({ method: 'GET', url: '/test' });
            expect(response2.statusCode).toBe(200);

            // Third request should be rate limited
            const response3 = await app.inject({ method: 'GET', url: '/test' });
            expect(response3.statusCode).toBe(429);

            await app.close();
        });
    });
});
