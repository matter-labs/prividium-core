import Fastify from 'fastify';
import pino from 'pino';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { TargetTypes } from '../db/schema';
import { RolesRepository } from '../repositories/roles-repository';
import { type Service, ServicesRepository } from '../repositories/services-repository';
import { SessionsRepository } from '../repositories/sessions-repository';
import { type Tenant, TenantsRepository } from '../repositories/tenants-repository';
import { type User, UsersRepository } from '../repositories/users-repository';
import { SessionService } from '../services/session-service';
import { sessionTypes } from '../utils/schemas/auth';
import type { ApiKeyAuthValidator } from './api-key-auth';
import { SessionsAuthValidator } from './sessions-auth';

/**
 * Helper to create a session in the DB with the proper hash.
 * Returns both the plaintext token (for Bearer header) and the DB record.
 */
function createTestToken(plaintext: string) {
    return { plaintext, hash: SessionService.hashToken(plaintext) };
}

describe('SessionsAuthValidator', () => {
    let validator: SessionsAuthValidator;
    let rolesRepo: RolesRepository;
    let sessionsRepo: SessionsRepository;
    let usersRepo: UsersRepository;
    let tenantsRepo: TenantsRepository;
    let servicesRepo: ServicesRepository;
    let user: User;
    let tenant: Tenant;
    let service: Service;

    const silence = pino({ level: 'silent' });

    beforeEach<Fixture>(async ({ db }) => {
        rolesRepo = new RolesRepository(db);

        sessionsRepo = new SessionsRepository(db);
        usersRepo = new UsersRepository(db);
        tenantsRepo = new TenantsRepository(db);
        servicesRepo = new ServicesRepository(db);

        // Create a mock ApiKeyAuthValidator (not used in these tests, but required by the constructor)
        const mockApiKeyAuthValidator = {} as ApiKeyAuthValidator;

        validator = new SessionsAuthValidator({
            logger: silence,
            repos: new Repositories(db),
            apiKeyAuthValidator: mockApiKeyAuthValidator
        });

        // Create test user
        const adminRole = await rolesRepo.createOrUpdateAdminRole();
        const editorRole = await rolesRepo.create({ roleName: 'editor', systemPermissions: [] });
        user = await usersRepo.create({
            oidcSub: 'test-user-sub',
            displayName: 'Test User',
            roles: [adminRole.id, editorRole.id],
            source: 'adminPanel'
        });

        // Create test tenant
        const walletPrivateKey = generatePrivateKey();
        const walletAddress = privateKeyToAddress(walletPrivateKey);
        tenant = await tenantsRepo.create({
            name: 'Test Tenant',
            publicKey: walletAddress,
            defaultRoles: []
        });

        // Create test service
        const servicePrivateKey = generatePrivateKey();
        const serviceAddress = privateKeyToAddress(servicePrivateKey);
        service = await servicesRepo.create({
            name: 'Test Service',
            publicKey: serviceAddress,
            description: 'A test service'
        });
    });

    describe('buildHook - token extraction', () => {
        it('should throw UnauthorizedError when authorization header is missing', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.user }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {}
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid session');
        });

        it('should throw UnauthorizedError when authorization header is not Bearer', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.user }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: 'Basic sometoken'
                }
            });

            expect(response.statusCode).toEqual(401);
        });

        it('should throw UnauthorizedError when authorization header has extra parts', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.user }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: 'Bearer token extra-part'
                }
            });

            expect(response.statusCode).toEqual(401);
        });

        it('should throw UnauthorizedError when token is missing', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.user }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: 'Bearer'
                }
            });

            expect(response.statusCode).toEqual(401);
        });
    });

    describe('buildHook - session validation', () => {
        it('should throw UnauthorizedError when session is not found or expired', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.user }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: 'Bearer invalid-token'
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid session');
        });

        it('should throw UnauthorizedError when session has invalid userId', async () => {
            // Create a valid user and session, then delete the user to simulate invalid userId
            const tempUser = await usersRepo.create({
                oidcSub: 'temp-user-sub',
                displayName: 'Temp User',
                source: 'adminPanel'
            });

            const tok = createTestToken('valid-token-123');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: tempUser.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            // Delete the user to make the session have an invalid userId
            await usersRepo.delete(tempUser.id);

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.user }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid session');
        });

        it('should throw error when session has invalid tenantId', async () => {
            // Create a valid tenant and session, then delete the tenant to simulate invalid tenantId
            const walletPrivateKey = generatePrivateKey();
            const walletAddress = privateKeyToAddress(walletPrivateKey);
            const tempTenant = await tenantsRepo.create({
                name: 'Temp Tenant',
                publicKey: walletAddress,
                defaultRoles: []
            });

            const tok = createTestToken('valid-token-456');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: null,
                tenantId: tempTenant.id,
                expiresAt: new Date(Date.now() + 10000)
            });

            // Delete the tenant to make the session have an invalid tenantId
            await tenantsRepo.delete(tempTenant.id);

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.tenant }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(401);
        });
    });

    describe('buildHook - user authentication', () => {
        it('should successfully authenticate user without role requirements', async () => {
            const tok = createTestToken('user-session-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: user.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.user }] }));
            app.get('/test', async (req, reply) => {
                const currentUser = req.auth.currentUser();
                return reply.send({
                    userId: currentUser.id,
                    type: req.auth.type,
                    tokenHash: req.auth.tokenHash
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
            const body = response.json();
            expect(body.userId).toEqual(user.id);
            expect(body.type).toBe(TargetTypes.enum.user);
            expect(body.tokenHash).toBe(tok.hash);
        });

        it('should successfully authenticate user with matching roles', async () => {
            const tok = createTestToken('user-with-roles-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: user.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({ targets: [{ type: TargetTypes.enum.user, requiredRoles: ['admin'] }] })
            );
            app.get('/test', async (req, reply) => {
                const currentUser = req.auth.currentUser();
                return reply.send({ userId: currentUser.id });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json().userId).toEqual(user.id);
        });

        it('should throw ForbiddenError when user is missing required roles', async () => {
            // Create user without required roles
            const viewerRole = await rolesRepo.create({ roleName: 'viewer', systemPermissions: [] });
            const limitedUser = await usersRepo.create({
                oidcSub: 'limited-user-sub',
                displayName: 'Limited User',
                roles: [viewerRole.id],
                source: 'adminPanel'
            });

            const tok = createTestToken('limited-user-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: limitedUser.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [{ type: TargetTypes.enum.user, requiredRoles: ['admin', 'editor'] }]
                })
            );
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(403);
            expect(response.json().message).toContain('Forbidden access');
        });
    });

    describe('buildHook - tenant authentication', () => {
        it('should successfully authenticate tenant', async () => {
            const tok = createTestToken('tenant-session-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: null,
                tenantId: tenant.id,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.tenant }] }));
            app.get('/test', async (req, reply) => {
                const currentTenant = req.auth.currentTenant();
                return reply.send({
                    tenantId: currentTenant.id,
                    type: req.auth.type,
                    tokenHash: req.auth.tokenHash
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
            const body = response.json();
            expect(body.tenantId).toEqual(tenant.id);
            expect(body.type).toBe(TargetTypes.enum.tenant);
            expect(body.tokenHash).toBe(tok.hash);
        });
    });

    describe('buildHook - service authentication', () => {
        it('should successfully authenticate service', async () => {
            const tok = createTestToken('service-session-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: null,
                tenantId: null,
                serviceId: service.id,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.service }] }));
            app.get('/test', async (req, reply) => {
                const currentService = req.auth.currentService();
                return reply.send({
                    serviceId: currentService.id,
                    serviceName: currentService.name,
                    type: req.auth.type,
                    tokenHash: req.auth.tokenHash
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
            const body = response.json();
            expect(body.serviceId).toEqual(service.id);
            expect(body.serviceName).toEqual('Test Service');
            expect(body.type).toBe(TargetTypes.enum.service);
            expect(body.tokenHash).toBe(tok.hash);
        });

        it('should reject service session for deleted service', async () => {
            // Create and then delete service
            const tempServiceKey = generatePrivateKey();
            const tempServiceAddress = privateKeyToAddress(tempServiceKey);
            const tempService = await servicesRepo.create({
                name: 'Temp Service',
                publicKey: tempServiceAddress
            });

            const tok = createTestToken('deleted-service-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: null,
                tenantId: null,
                serviceId: tempService.id,
                expiresAt: new Date(Date.now() + 10000)
            });

            // Delete the service
            await servicesRepo.deleteById(tempService.id);

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.service }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            // Session with deleted service returns unauthorized
            // The findById throws NotFoundError which is converted to 401 by Fastify's error handling
            expect(response.statusCode).toEqual(401);
        });
    });

    describe('buildHook - anonymous', () => {
        it('should allow anonymous user for empty auth header', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: sessionTypes.enum.anonymous }] }));
            app.get('/test', async (req, reply) => {
                return reply.send({
                    type: req.auth.type
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: ''
                }
            });

            expect(response.statusCode).toEqual(200);
            const body = response.json();
            expect(body.type).toBe(sessionTypes.enum.anonymous);
        });

        it('should allow anonymous user with no auth header', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: sessionTypes.enum.anonymous }] }));
            app.get('/test', async (req, reply) => {
                return reply.send({
                    type: req.auth.type
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test'
            });

            expect(response.statusCode).toEqual(200);
            const body = response.json();
            expect(body.type).toBe(sessionTypes.enum.anonymous);
        });

        it('does not allow traffic with wrong auth header value', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: sessionTypes.enum.anonymous }] }));
            app.get('/test', async (req, reply) => {
                return reply.send({
                    type: req.auth.type
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: 'invalid'
                }
            });

            expect(response.statusCode).toEqual(401);
        });

        it('does not allow traffic if anonymous is not explicitly defined', async () => {
            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: sessionTypes.enum.user }] }));
            app.get('/test', async (req, reply) => {
                return reply.send({
                    type: req.auth.type
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {} // no auth header
            });

            expect(response.statusCode).toEqual(401);
        });
    });

    describe('buildHook - multiple targets', () => {
        it('should match first target when user session provided', async () => {
            const tok = createTestToken('user-multi-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: user.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [{ type: TargetTypes.enum.user }, { type: TargetTypes.enum.tenant }]
                })
            );
            app.get('/test', async (req, reply) => {
                return reply.send({ type: req.auth.type });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json().type).toBe(TargetTypes.enum.user);
        });

        it('should match second target when tenant session provided', async () => {
            const tok = createTestToken('tenant-multi-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: null,
                tenantId: tenant.id,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [{ type: TargetTypes.enum.user }, { type: TargetTypes.enum.tenant }]
                })
            );
            app.get('/test', async (req, reply) => {
                return reply.send({ type: req.auth.type });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json().type).toBe(TargetTypes.enum.tenant);
        });

        it('should match service target when service session provided', async () => {
            const tok = createTestToken('service-multi-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: null,
                tenantId: null,
                serviceId: service.id,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [
                        { type: TargetTypes.enum.user },
                        { type: TargetTypes.enum.tenant },
                        { type: TargetTypes.enum.service }
                    ]
                })
            );
            app.get('/test', async (req, reply) => {
                return reply.send({ type: req.auth.type });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
            expect(response.json().type).toBe(TargetTypes.enum.service);
        });

        it('should throw UnauthorizedError when no targets match', async () => {
            // Create user session but only allow tenant authentication
            const tok = createTestToken('user-wrong-type-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: user.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.tenant }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid session');
        });

        it('should throw UnauthorizedError when service session used but service not in targets', async () => {
            const tok = createTestToken('service-not-allowed-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: null,
                tenantId: null,
                serviceId: service.id,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [{ type: TargetTypes.enum.user }, { type: TargetTypes.enum.tenant }]
                })
            );
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid session');
        });

        it('should match user target when roles are required and present', async () => {
            const tok = createTestToken('user-roles-match-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: user.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [
                        { type: TargetTypes.enum.user, requiredRoles: ['admin'] },
                        { type: TargetTypes.enum.tenant }
                    ]
                })
            );
            app.get('/test', async (req, reply) => {
                const currentUser = req.auth.currentUser();
                return reply.send({
                    type: req.auth.type,
                    userId: currentUser.id
                });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
            const body = response.json();
            expect(body.type).toBe(TargetTypes.enum.user);
            expect(body.userId).toEqual(user.id);
        });
    });

    describe('buildHook - requiredSystemPermissions', () => {
        it('should pass when user has matching system permission', async () => {
            const auditorRole = await rolesRepo.create({ roleName: 'auditor', systemPermissions: ['admin_read'] });
            const auditorUser = await usersRepo.create({
                oidcSub: 'auditor-sub',
                displayName: 'Auditor User',
                roles: [auditorRole.id],
                source: 'adminPanel'
            });

            const tok = createTestToken('auditor-session-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: auditorUser.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [{ type: TargetTypes.enum.user, requiredSystemPermissions: ['admin_read'] }]
                })
            );
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
        });

        it('should fail when user does not have matching system permission', async () => {
            const basicRole = await rolesRepo.create({ roleName: 'basic', systemPermissions: ['contract_deployment'] });
            const basicUser = await usersRepo.create({
                oidcSub: 'basic-perm-sub',
                displayName: 'Basic User',
                roles: [basicRole.id],
                source: 'adminPanel'
            });

            const tok = createTestToken('basic-perm-session-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: basicUser.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [{ type: TargetTypes.enum.user, requiredSystemPermissions: ['admin_read'] }]
                })
            );
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(403);
            expect(response.json().message).toContain('Forbidden access');
        });

        it('should support request-based buildHook config for read-only admin routes', async () => {
            const auditorRole = await rolesRepo.create({ roleName: 'auditor', systemPermissions: ['admin_read'] });
            const auditorUser = await usersRepo.create({
                oidcSub: 'auditor-dynamic-sub',
                displayName: 'Auditor Dynamic User',
                roles: [auditorRole.id],
                source: 'adminPanel'
            });

            const tok = createTestToken('auditor-dynamic-session-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: auditorUser.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook((req) => ({
                    targets: [
                        {
                            type: TargetTypes.enum.user,
                            ...(req.method === 'GET'
                                ? { requiredSystemPermissions: ['admin_read'] }
                                : { requiredRoles: ['admin'] })
                        }
                    ]
                }))
            );
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });
            app.post('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const getResponse = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            const postResponse = await app.inject({
                method: 'POST',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(getResponse.statusCode).toEqual(200);
            expect(postResponse.statusCode).toEqual(403);
            expect(postResponse.json().message).toContain('Forbidden access');
        });

        it('should require both roles and system permissions when both are specified', async () => {
            // User has the permission but not the role
            const perm_onlyRole = await rolesRepo.create({ roleName: 'perm-only', systemPermissions: ['admin_read'] });
            const permOnlyUser = await usersRepo.create({
                oidcSub: 'perm-only-sub',
                displayName: 'Perm Only User',
                roles: [perm_onlyRole.id],
                source: 'adminPanel'
            });

            const tok = createTestToken('perm-only-session-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: permOnlyUser.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [
                        {
                            type: TargetTypes.enum.user,
                            requiredRoles: ['admin'],
                            requiredSystemPermissions: ['admin_read']
                        }
                    ]
                })
            );
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            // User has the permission but not the admin role, so should fail
            expect(response.statusCode).toEqual(403);
            expect(response.json().message).toContain('Forbidden access');
        });

        it('should pass when user has both required roles and system permissions', async () => {
            // Admin user already has admin role which has all system permissions
            const tok = createTestToken('admin-both-check-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: user.id,
                tenantId: null,
                expiresAt: new Date(Date.now() + 10000)
            });

            const app = Fastify();
            app.addHook(
                'preHandler',
                validator.buildHook({
                    targets: [
                        {
                            type: TargetTypes.enum.user,
                            requiredRoles: ['admin'],
                            requiredSystemPermissions: ['admin_read']
                        }
                    ]
                })
            );
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(200);
        });
    });

    describe('expired sessions', () => {
        it('should reject expired session', async () => {
            // Create session that's already expired (at least one day in the past)
            // The query uses CURRENT_DATE comparison, so we need to go back at least a day
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const tok = createTestToken('expired-token');
            await sessionsRepo.create({
                tokenHash: tok.hash,
                userId: user.id,
                tenantId: null,
                expiresAt: yesterday
            });

            const app = Fastify();
            app.addHook('preHandler', validator.buildHook({ targets: [{ type: TargetTypes.enum.user }] }));
            app.get('/test', async (_req, reply) => {
                return reply.send({ success: true });
            });

            const response = await app.inject({
                method: 'GET',
                url: '/test',
                headers: {
                    authorization: `Bearer ${tok.plaintext}`
                }
            });

            expect(response.statusCode).toEqual(401);
            expect(response.json().message).toContain('Invalid session');
        });
    });
});
