import type { Address } from 'viem';
import { beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { UnauthorizedError } from '../utils/error-types';
import { SessionService } from './session-service';

describe('SessionService', () => {
    let repos: Repositories;
    let userId: string;
    let tenantId: string;
    let serviceId: string;

    const testAddress = '0x1234567890123456789012345678901234567890' as Address;
    const servicePublicKey = '0xabcdef1234567890abcdef1234567890abcdef12' as Address;

    beforeEach<Fixture>(async ({ db }) => {
        repos = new Repositories(db);
        const user = await repos.users.create({
            displayName: 'Test User',
            oidcSub: 'session-service-user',
            wallets: [testAddress],
            source: 'adminPanel'
        });
        userId = user.id;

        const tenant = await repos.tenants.create({
            name: 'session-service-tenant',
            publicKey: testAddress,
            defaultRoles: []
        });
        tenantId = tenant.id;

        const svc = await repos.services.create({
            name: 'session-service-svc',
            publicKey: servicePublicKey
        });
        serviceId = svc.id;
    });

    it('stores only the token hash for newly created sessions', async () => {
        const service = new SessionService({
            repos,
            opts: {
                userSessionDurationSeconds: 3600,
                tenantSessionDurationSeconds: 3600,
                serviceSessionDurationSeconds: 3600
            }
        });

        const created = await service.createUserSession({
            userId,
            ipAddress: '127.0.0.1',
            userAgent: 'session-service-test'
        });

        const sessions = await repos.sessions.findActiveByUserId(userId);

        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.tokenHash).toBe(SessionService.hashToken(created.token));
        expect(created.expiresAt).toEqual(sessions[0]?.expiresAt);
    });

    it('sets expiresAt equal to renewableUntil for a user session when USER_IDLE_TIMEOUT_SECONDS is unset', async () => {
        const capSeconds = 3600;
        const service = new SessionService({
            repos,
            opts: {
                userSessionDurationSeconds: capSeconds,
                tenantSessionDurationSeconds: 3600,
                serviceSessionDurationSeconds: 3600
                // userIdleTimeoutSeconds intentionally omitted — feature OFF
            }
        });

        const nowMs = Date.now();
        const created = await service.createUserSession({
            userId,
            ipAddress: '127.0.0.1',
            userAgent: 'session-service-test'
        });

        expect(created.expiresAt).toEqual(created.renewableUntil);
        expect(created.renewableUntil.getTime()).toBeCloseTo(nowMs + capSeconds * 1000, -3);
    });

    it('sets a sliding expiresAt earlier than renewableUntil for a user session when the idle timeout is set', async () => {
        const capSeconds = 3600; // absolute cap: 1 hour
        const idleSeconds = 600; // idle deadline: 10 minutes
        const service = new SessionService({
            repos,
            opts: {
                userSessionDurationSeconds: capSeconds,
                tenantSessionDurationSeconds: 3600,
                serviceSessionDurationSeconds: 3600,
                userIdleTimeoutSeconds: idleSeconds
            }
        });

        const nowMs = Date.now();
        const created = await service.createUserSession({
            userId,
            ipAddress: '127.0.0.1',
            userAgent: 'session-service-test'
        });

        expect(created.expiresAt.getTime()).toBeLessThan(created.renewableUntil.getTime());
        expect(created.expiresAt.getTime()).toBeCloseTo(nowMs + idleSeconds * 1000, -3);
        expect(created.renewableUntil.getTime()).toBeCloseTo(nowMs + capSeconds * 1000, -3);
    });

    it('sets tenant session expiresAt equal to renewableUntil', async () => {
        const service = new SessionService({
            repos,
            opts: {
                userSessionDurationSeconds: 3600,
                tenantSessionDurationSeconds: 3600,
                serviceSessionDurationSeconds: 3600,
                userIdleTimeoutSeconds: 600 // only affects user sessions
            }
        });

        const created = await service.createTenantSession({
            tenantId,
            ipAddress: '127.0.0.1',
            userAgent: 'session-service-test'
        });

        expect(created.expiresAt).toEqual(created.renewableUntil);
    });

    it('sets service session expiresAt equal to renewableUntil', async () => {
        const service = new SessionService({
            repos,
            opts: {
                userSessionDurationSeconds: 3600,
                tenantSessionDurationSeconds: 3600,
                serviceSessionDurationSeconds: 86400,
                userIdleTimeoutSeconds: 600 // only affects user sessions
            }
        });

        const created = await service.createServiceSession({
            serviceId,
            ipAddress: '127.0.0.1',
            userAgent: 'session-service-test'
        });

        expect(created.expiresAt).toEqual(created.renewableUntil);
    });

    it('sets docs session expiresAt equal to renewableUntil even when userIdleTimeoutSeconds is set', async () => {
        const service = new SessionService({
            repos,
            opts: {
                userSessionDurationSeconds: 3600,
                tenantSessionDurationSeconds: 3600,
                serviceSessionDurationSeconds: 3600,
                userIdleTimeoutSeconds: 600 // docs sessions must NOT apply idle sliding
            }
        });

        const created = await service.createDocsSession({
            userId,
            ipAddress: '127.0.0.1',
            userAgent: 'session-service-test'
        });

        // Docs sessions skip idle sliding — expiresAt must equal renewableUntil (== cap).
        expect(created.expiresAt).toEqual(created.renewableUntil);
    });

    describe('extendSession', () => {
        it('idle enabled, user session: returns slid expiresAt within renewableUntil', async () => {
            const capSeconds = 3600;
            const idleSeconds = 300;
            const service = new SessionService({
                repos,
                opts: {
                    userSessionDurationSeconds: capSeconds,
                    tenantSessionDurationSeconds: 3600,
                    serviceSessionDurationSeconds: 3600,
                    userIdleTimeoutSeconds: idleSeconds
                }
            });

            const { token, renewableUntil: createdAbsolute } = await service.createUserSession({
                userId,
                ipAddress: '127.0.0.1',
                userAgent: 'session-service-test'
            });
            const tokenHash = SessionService.hashToken(token);

            const beforeExtend = Date.now();
            const { expiresAt, renewableUntil, extended } = await service.extendSession(tokenHash);

            expect(expiresAt.getTime()).toBeGreaterThanOrEqual(beforeExtend + idleSeconds * 1000 - 500);
            expect(expiresAt.getTime()).toBeLessThanOrEqual(renewableUntil.getTime());
            expect(renewableUntil.getTime()).toBe(createdAbsolute.getTime());
            expect(extended).toBe(true);
        });

        it('already at the cap: reports extended=false and leaves the deadline untouched', async () => {
            // idle == cap means createSession sets expiresAt === renewableUntil, so the slide
            // computes the value the row already holds.
            const seconds = 600;
            const service = new SessionService({
                repos,
                opts: {
                    userSessionDurationSeconds: seconds,
                    tenantSessionDurationSeconds: 3600,
                    serviceSessionDurationSeconds: 3600,
                    userIdleTimeoutSeconds: seconds
                }
            });

            const {
                token,
                expiresAt: createdExpiry,
                renewableUntil: createdAbsolute
            } = await service.createUserSession({
                userId,
                ipAddress: '127.0.0.1',
                userAgent: 'extend-noop-test'
            });
            const tokenHash = SessionService.hashToken(token);

            const { expiresAt, renewableUntil, extended } = await service.extendSession(tokenHash);

            expect(extended).toBe(false);
            expect(expiresAt.getTime()).toBe(createdExpiry.getTime());
            expect(renewableUntil.getTime()).toBe(createdAbsolute.getTime());
        });

        it('idle enabled, user session: expiresAt is capped at renewableUntil when idle > cap', async () => {
            // Use an idle timeout longer than the session duration to force the min() cap
            const capSeconds = 600;
            const idleSeconds = 3600; // longer than cap
            const service = new SessionService({
                repos,
                opts: {
                    userSessionDurationSeconds: capSeconds,
                    tenantSessionDurationSeconds: 3600,
                    serviceSessionDurationSeconds: 3600,
                    userIdleTimeoutSeconds: idleSeconds
                }
            });

            const { token, renewableUntil: createdAbsolute } = await service.createUserSession({
                userId,
                ipAddress: '127.0.0.1',
                userAgent: 'extend-cap-test'
            });
            const tokenHash = SessionService.hashToken(token);

            const { expiresAt, renewableUntil } = await service.extendSession(tokenHash);

            expect(expiresAt.getTime()).toBe(renewableUntil.getTime());
            expect(renewableUntil.getTime()).toBe(createdAbsolute.getTime());
        });

        it('idle disabled: returns current deadlines unchanged (no-op)', async () => {
            const service = new SessionService({
                repos,
                opts: {
                    userSessionDurationSeconds: 3600,
                    tenantSessionDurationSeconds: 3600,
                    serviceSessionDurationSeconds: 3600
                    // no userIdleTimeoutSeconds — feature OFF
                }
            });

            const {
                token,
                expiresAt: createdExpiry,
                renewableUntil: createdAbsolute
            } = await service.createUserSession({
                userId,
                ipAddress: '127.0.0.1',
                userAgent: 'no-idle-test'
            });
            const tokenHash = SessionService.hashToken(token);

            const { expiresAt, renewableUntil, extended } = await service.extendSession(tokenHash);

            expect(extended).toBe(false);
            expect(expiresAt.getTime()).toBe(createdExpiry.getTime());
            expect(renewableUntil.getTime()).toBe(createdAbsolute.getTime());
        });

        it('AC7 guard: tenant session with idle ENABLED returns unchanged deadlines', async () => {
            // Idle timeout is set globally, but tenant sessions must not be shortened
            const service = new SessionService({
                repos,
                opts: {
                    userSessionDurationSeconds: 3600,
                    tenantSessionDurationSeconds: 86400, // 24h tenant session
                    serviceSessionDurationSeconds: 3600,
                    userIdleTimeoutSeconds: 300 // 5-minute user idle window
                }
            });

            const {
                token,
                expiresAt: createdExpiry,
                renewableUntil: createdAbsolute
            } = await service.createTenantSession({
                tenantId,
                ipAddress: '127.0.0.1',
                userAgent: 'tenant-idle-test'
            });
            const tokenHash = SessionService.hashToken(token);

            const { expiresAt, renewableUntil, extended } = await service.extendSession(tokenHash);

            // Tenant deadlines must be unchanged — must NOT be shortened to the 300s user window
            expect(extended).toBe(false);
            expect(expiresAt.getTime()).toBe(createdExpiry.getTime());
            expect(renewableUntil.getTime()).toBe(createdAbsolute.getTime());
        });

        it('AC7 guard: service session with idle ENABLED returns unchanged deadlines', async () => {
            const service = new SessionService({
                repos,
                opts: {
                    userSessionDurationSeconds: 3600,
                    tenantSessionDurationSeconds: 3600,
                    serviceSessionDurationSeconds: 86400, // 24h service session
                    userIdleTimeoutSeconds: 300 // 5-minute user idle window
                }
            });

            const {
                token,
                expiresAt: createdExpiry,
                renewableUntil: createdAbsolute
            } = await service.createServiceSession({
                serviceId,
                ipAddress: '127.0.0.1',
                userAgent: 'service-idle-test'
            });
            const tokenHash = SessionService.hashToken(token);

            const { expiresAt, renewableUntil, extended } = await service.extendSession(tokenHash);

            // Service deadlines must be unchanged — must NOT be shortened to the 300s user window
            expect(extended).toBe(false);
            expect(expiresAt.getTime()).toBe(createdExpiry.getTime());
            expect(renewableUntil.getTime()).toBe(createdAbsolute.getTime());
        });

        it('lost-race fallback (FIX 3): when repo update matches nothing, returns pre-read unchanged deadlines', async () => {
            const idleSeconds = 300;
            const service = new SessionService({
                repos,
                opts: {
                    userSessionDurationSeconds: 3600,
                    tenantSessionDurationSeconds: 3600,
                    serviceSessionDurationSeconds: 3600,
                    userIdleTimeoutSeconds: idleSeconds
                }
            });

            const {
                token,
                expiresAt: createdExpiry,
                renewableUntil: createdAbsolute
            } = await service.createUserSession({
                userId,
                ipAddress: '127.0.0.1',
                userAgent: 'toctou-test'
            });
            const tokenHash = SessionService.hashToken(token);

            // Simulate the TOCTOU race: the DB update matches nothing (session expired
            // between findActive and extendByTokenHash).
            vi.spyOn(repos.sessions, 'extendByTokenHash').mockResolvedValueOnce(undefined);

            const { expiresAt, renewableUntil, extended } = await service.extendSession(tokenHash);

            // Must return the pre-read deadlines, NOT the computed newExpiresAt
            expect(extended).toBe(false);
            expect(expiresAt.getTime()).toBe(createdExpiry.getTime());
            expect(renewableUntil.getTime()).toBe(createdAbsolute.getTime());

            vi.restoreAllMocks();
        });

        it('missing session: throws UnauthorizedError for an unknown token hash', async () => {
            const service = new SessionService({
                repos,
                opts: {
                    userSessionDurationSeconds: 3600,
                    tenantSessionDurationSeconds: 3600,
                    serviceSessionDurationSeconds: 3600,
                    userIdleTimeoutSeconds: 300
                }
            });

            await expect(service.extendSession('nonexistent-token-hash')).rejects.toThrow(UnauthorizedError);
        });
    });
});
