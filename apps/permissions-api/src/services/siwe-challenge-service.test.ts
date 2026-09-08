import { subMinutes, subSeconds } from 'date-fns';
import type { Address } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { servicesTable, siweChallengeLogTable, tenantsTable } from '../db/schema';
import { UsersRepository } from '../repositories/users-repository';
import { AuditLogsService, fakeAuditLogContextForTests } from '../services/audit-logs-service';
import { SiweService } from '../services/siwe-service';
import { InvalidInputError, RateLimitError } from '../utils/error-types';
import { SiweChallengeService } from './siwe-challenge-service';

type ServiceDeps = ConstructorParameters<typeof SiweChallengeService>[0];

describe('SiweChallengeService', () => {
    const testAddress = '0x1234567890123456789012345678901234567890' as Address;
    const testSecret = '444556204f4e4c5920686d61632073656372657420646f206e6f742075736521';
    const expirationMs = 5 * 60 * 1000;
    const chainId = 6565;
    const validDomains = ['example.com', 'localhost:3000'];
    const challengeRateLimitCount = 10;
    const challengeRateLimitWindowSeconds = 5 * 60;

    let usersRepository: UsersRepository;
    let challengeService: SiweChallengeService;
    let siweService: SiweService;
    let auditLogsService: AuditLogsService;
    let repos: Repositories;

    const buildService = (overrides: Partial<ServiceDeps> = {}) =>
        new SiweChallengeService({
            repos,
            expirationDeltaMs: expirationMs,
            chainId,
            validDomains,
            adminWallets: [],
            challengeRateLimitCount,
            challengeRateLimitWindowSeconds,
            rateLimitBypassIps: [],
            siweService,
            multiOrgEnabled: false,
            brandName: 'Prividium™',
            ...overrides
        });

    beforeEach<Fixture>(async ({ db }) => {
        usersRepository = new UsersRepository(db);
        repos = new Repositories(db);
        auditLogsService = new AuditLogsService(repos);
        siweService = new SiweService({
            repos: repos,
            chainId,
            hmacSecret: testSecret
        });
        challengeService = buildService();
    });

    it('creates login message with nonce token for registered wallet', async () => {
        const user = await usersRepository.create({
            displayName: 'Test User',
            source: 'adminPanel',
            wallets: [testAddress]
        });

        const result = await challengeService.createForLogin(
            { address: testAddress, domain: 'example.com' },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.nonce).toBeTruthy();
        expect(result.msg).toContain(result.nonce);
        expect(result.nonceToken).toBeTruthy();

        const tokenPayload = siweService.verifyNonceToken(result.nonceToken, result.nonce);
        expect(tokenPayload.targetType).toBe('user');
        expect(tokenPayload.targetId).toBe(user.id);
        expect(tokenPayload.address).toBe(testAddress);
    });

    it('returns 200-compatible payload for unregistered wallet with null user target', async () => {
        const unknownAddress = '0x9999999999999999999999999999999999999999' as Address;
        const result = await challengeService.createForLogin(
            { address: unknownAddress, domain: 'example.com' },
            fakeAuditLogContextForTests(auditLogsService)
        );

        const tokenPayload = siweService.verifyNonceToken(result.nonceToken, result.nonce);
        expect(tokenPayload.targetType).toBe('user');
        expect(tokenPayload.targetId).toBeNull();
    });

    it('returns null tenant target when tenant does not exist', async () => {
        const result = await challengeService.createForTenant({ address: testAddress });
        const tokenPayload = siweService.verifyNonceToken(result.nonceToken, result.nonce);

        expect(tokenPayload.targetType).toBe('tenant');
        expect(tokenPayload.targetId).toBeNull();
    });

    it('returns null targetId even when tenant exists (oracle fix)', async ({ db }: Fixture) => {
        await db.insert(tenantsTable).values({
            id: 'd0e8a06f-f11f-49b8-a1bb-4f3038f5f3dc',
            name: 'tenant',
            publicKey: testAddress
        });

        const result = await challengeService.createForTenant({ address: testAddress });
        const tokenPayload = siweService.verifyNonceToken(result.nonceToken, result.nonce);

        expect(tokenPayload.targetType).toBe('tenant');
        expect(tokenPayload.targetId).toBeNull();
    });

    it('returns null service target when service does not exist', async () => {
        const result = await challengeService.createForService({ address: testAddress });
        const tokenPayload = siweService.verifyNonceToken(result.nonceToken, result.nonce);

        expect(tokenPayload.targetType).toBe('service');
        expect(tokenPayload.targetId).toBeNull();
    });

    it('returns null targetId even when service exists (oracle fix)', async ({ db }: Fixture) => {
        await db.insert(servicesTable).values({
            id: '08c3c812-d69a-4510-bf63-5ee099f24f56',
            name: 'service',
            publicKey: testAddress
        });

        const result = await challengeService.createForService({ address: testAddress });
        const tokenPayload = siweService.verifyNonceToken(result.nonceToken, result.nonce);

        expect(tokenPayload.targetType).toBe('service');
        expect(tokenPayload.targetId).toBeNull();
    });

    it('creates wallet-association message bound to user id', async () => {
        const user = await usersRepository.create({
            displayName: 'Wallet Owner',
            source: 'adminPanel',
            wallets: []
        });

        const result = await challengeService.createForWalletAssociation(testAddress, 'example.com', user.id);
        const tokenPayload = siweService.verifyNonceToken(result.nonceToken, result.nonce);

        expect(tokenPayload.targetType).toBe('user');
        expect(tokenPayload.targetId).toBe(user.id);
        expect(tokenPayload.address).toBe(testAddress);
    });

    it('rate limits login challenges after 10 recent requests for the same address', async ({ db }: Fixture) => {
        const now = new Date();

        await db.insert(siweChallengeLogTable).values(
            Array.from({ length: 10 }, () => ({
                address: testAddress,
                targetType: 'user' as const,
                createdAt: subSeconds(now, 60)
            }))
        );

        await expect(
            challengeService.createForLogin(
                { address: testAddress, domain: 'example.com' },
                fakeAuditLogContextForTests(auditLogsService)
            )
        ).rejects.toThrow(RateLimitError);
    });

    it('ignores expired challenge logs when rate limiting login challenges', async ({ db }: Fixture) => {
        const now = new Date();

        await db.insert(siweChallengeLogTable).values(
            Array.from({ length: 10 }, () => ({
                address: testAddress,
                targetType: 'user' as const,
                createdAt: subMinutes(now, 6)
            }))
        );

        await expect(
            challengeService.createForLogin(
                { address: testAddress, domain: 'example.com' },
                fakeAuditLogContextForTests(auditLogsService)
            )
        ).resolves.toMatchObject({
            nonce: expect.any(String),
            msg: expect.any(String),
            nonceToken: expect.any(String)
        });
    });

    it('bypasses rate limit for requests from a whitelisted IP', async ({ db }: Fixture) => {
        const bypassService = buildService({ rateLimitBypassIps: ['10.0.0.1'] });

        const now = new Date();
        await db.insert(siweChallengeLogTable).values(
            Array.from({ length: 10 }, () => ({
                address: testAddress,
                targetType: 'user' as const,
                createdAt: subSeconds(now, 60)
            }))
        );

        // Should NOT throw despite being over the rate limit
        await expect(
            bypassService.createForLogin(
                { address: testAddress, domain: 'example.com' },
                fakeAuditLogContextForTests(auditLogsService),
                '10.0.0.1'
            )
        ).resolves.toMatchObject({ nonce: expect.any(String) });
    });

    it('still enforces rate limit for non-whitelisted IP', async ({ db }: Fixture) => {
        const bypassService = buildService({ rateLimitBypassIps: ['10.0.0.1'] });

        const now = new Date();
        await db.insert(siweChallengeLogTable).values(
            Array.from({ length: 10 }, () => ({
                address: testAddress,
                targetType: 'user' as const,
                createdAt: subSeconds(now, 60)
            }))
        );

        await expect(
            bypassService.createForLogin(
                { address: testAddress, domain: 'example.com' },
                fakeAuditLogContextForTests(auditLogsService),
                '192.168.1.1'
            )
        ).rejects.toThrow(RateLimitError);
    });

    it('creates login message when domain is omitted', async () => {
        const result = await challengeService.createForLogin(
            { address: testAddress },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.nonce).toBeTruthy();
        expect(result.msg).toBeTruthy();
        expect(result.nonceToken).toBeTruthy();
    });

    it('throws when domain is not in allowed list', async () => {
        await expect(
            challengeService.createForLogin(
                { address: testAddress, domain: 'invalid-domain.com' },
                fakeAuditLogContextForTests(auditLogsService)
            )
        ).rejects.toThrow(InvalidInputError);
    });

    it('rolls back admin wallet auto-provisioning when challenge creation fails', async () => {
        await repos.roles.createOrUpdateAdminRole();

        const adminWalletChallengeService = buildService({ adminWallets: [testAddress] });

        await expect(
            adminWalletChallengeService.createForLogin(
                { address: testAddress, domain: 'invalid-domain.com' },
                fakeAuditLogContextForTests(auditLogsService)
            )
        ).rejects.toThrow(InvalidInputError);

        expect(await usersRepository.findByAddress(testAddress)).toBeUndefined();
    });

    it('login challenge msg contains configured brand name in its statement', async () => {
        const branded = buildService({ brandName: 'AcmeCorp' });

        const result = await branded.createForLogin(
            { address: testAddress, domain: 'example.com' },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.msg).toContain('AcmeCorp');
    });

    it('wallet-association challenge msg contains configured brand name in its statement', async () => {
        const branded = buildService({ brandName: 'AcmeCorp' });

        const user = await usersRepository.create({
            displayName: 'Test User',
            source: 'adminPanel',
            wallets: [testAddress]
        });

        const result = await branded.createForWalletAssociation(testAddress, 'example.com', user.id);

        expect(result.msg).toContain('AcmeCorp');
    });

    it('service challenge msg contains configured brand name in its statement', async () => {
        const branded = buildService({ brandName: 'AcmeCorp' });

        const result = await branded.createForService({ address: testAddress });

        expect(result.msg).toContain('AcmeCorp');
    });

    it('tenant challenge msg does not contain brand name in its statement', async () => {
        const branded = buildService({ brandName: 'AcmeCorp' });

        const result = await branded.createForTenant({ address: testAddress });

        expect(result.msg).not.toContain('AcmeCorp');
    });

    const orgAwareService = () => buildService({ multiOrgEnabled: true });

    it('login challenge uses the org brand name when in org context (multi-org enabled)', async () => {
        const org = await repos.organizations.create({ name: 'Acme Inc', brandName: 'AcmeChain', defaultRoles: [] });

        const result = await orgAwareService().createForLogin(
            { address: testAddress, domain: 'example.com', organizationId: org.id },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.msg).toContain('Login to AcmeChain chain');
        expect(result.msg).not.toContain('Prividium™');
    });

    it('login challenge falls back to the zone brand when the org has no brand name', async () => {
        const org = await repos.organizations.create({ name: 'Unbranded Inc', defaultRoles: [] });

        const result = await orgAwareService().createForLogin(
            { address: testAddress, domain: 'example.com', organizationId: org.id },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.msg).toContain('Login to Prividium™ chain');
    });

    it('login challenge falls back to the zone brand for an unknown org id (does not throw)', async () => {
        const result = await orgAwareService().createForLogin(
            { address: testAddress, domain: 'example.com', organizationId: 'org_does_not_exist' },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.msg).toContain('Login to Prividium™ chain');
    });

    it('ignores organizationId and uses the zone brand when multi-org is disabled', async () => {
        const org = await repos.organizations.create({ name: 'Acme Inc', brandName: 'AcmeChain', defaultRoles: [] });

        // challengeService (from beforeEach) is constructed with multiOrgEnabled: false
        const result = await challengeService.createForLogin(
            { address: testAddress, domain: 'example.com', organizationId: org.id },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.msg).toContain('Login to Prividium™ chain');
        expect(result.msg).not.toContain('AcmeChain');
    });

    const orgOidcProvider = (organizationId: string, userPanelUrl: string | null) =>
        repos.oidcProviders.upsert({
            organizationId,
            issuer: `https://idp.${organizationId}.example.com`,
            jwksUri: `https://idp.${organizationId}.example.com/jwks`,
            audience: 'aud',
            clientId: 'client',
            userPanelUrl
        });

    it('login challenge accepts an org allowed domain when SIWE login is enabled for the org', async () => {
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweLoginEnabled: true,
            siweAllowedDomains: ['login.acme.example.com']
        });

        const result = await orgAwareService().createForLogin(
            { address: testAddress, domain: 'login.acme.example.com', organizationId: org.id },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.msg).toContain('login.acme.example.com');
    });

    it("login challenge accepts the host of the org's OIDC userPanelUrl by default when SIWE login is enabled", async () => {
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweLoginEnabled: true
        });
        await orgOidcProvider(org.id, 'https://user-panel.acme.example.com');

        const result = await orgAwareService().createForLogin(
            { address: testAddress, domain: 'user-panel.acme.example.com', organizationId: org.id },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.msg).toContain('user-panel.acme.example.com');
    });

    it('skips a malformed userPanelUrl instead of failing challenge creation', async () => {
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweLoginEnabled: true,
            siweAllowedDomains: ['login.acme.example.com']
        });
        await orgOidcProvider(org.id, 'not a url');

        const result = await orgAwareService().createForLogin(
            { address: testAddress, domain: 'login.acme.example.com', organizationId: org.id },
            fakeAuditLogContextForTests(auditLogsService)
        );
        expect(result.msg).toContain('login.acme.example.com');

        await expect(
            orgAwareService().createForLogin(
                { address: testAddress, domain: 'bogus.example.com', organizationId: org.id },
                fakeAuditLogContextForTests(auditLogsService)
            )
        ).rejects.toThrow(InvalidInputError);
    });

    it('rejects a SIWE-incompatible userPanelUrl host with a 400 instead of a 500', async () => {
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweLoginEnabled: true
        });
        // Valid URL, but its single-label host is rejected by viem's SIWE domain grammar.
        await orgOidcProvider(org.id, 'https://myapp');

        await expect(
            orgAwareService().createForLogin(
                { address: testAddress, domain: 'myapp', organizationId: org.id },
                fakeAuditLogContextForTests(auditLogsService)
            )
        ).rejects.toThrow(InvalidInputError);
    });

    it("rejects the org's domains when SIWE login is not enabled for the org", async () => {
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweAllowedDomains: ['login.acme.example.com']
        });
        await orgOidcProvider(org.id, 'https://user-panel.acme.example.com');

        for (const domain of ['login.acme.example.com', 'user-panel.acme.example.com']) {
            await expect(
                orgAwareService().createForLogin(
                    { address: testAddress, domain, organizationId: org.id },
                    fakeAuditLogContextForTests(auditLogsService)
                )
            ).rejects.toThrow(InvalidInputError);
        }
    });

    it("rejects another org's domain (org domains only apply to that org's challenges)", async () => {
        await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweLoginEnabled: true,
            siweAllowedDomains: ['login.acme.example.com']
        });
        const otherOrg = await repos.organizations.create({ name: 'Other Inc', defaultRoles: [] });

        await expect(
            orgAwareService().createForLogin(
                { address: testAddress, domain: 'login.acme.example.com', organizationId: otherOrg.id },
                fakeAuditLogContextForTests(auditLogsService)
            )
        ).rejects.toThrow(InvalidInputError);
    });

    it('rejects org domains when multi-org is disabled even if SIWE login is enabled', async () => {
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweLoginEnabled: true,
            siweAllowedDomains: ['login.acme.example.com']
        });

        // challengeService (from beforeEach) is constructed with multiOrgEnabled: false
        await expect(
            challengeService.createForLogin(
                { address: testAddress, domain: 'login.acme.example.com', organizationId: org.id },
                fakeAuditLogContextForTests(auditLogsService)
            )
        ).rejects.toThrow(InvalidInputError);
    });

    it("wallet-association challenge uses the org member's org brand and accepts the org domain", async () => {
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            brandName: 'AcmeChain',
            defaultRoles: [],
            siweLoginEnabled: true,
            siweAllowedDomains: ['login.acme.example.com']
        });
        const member = await usersRepository.create({
            displayName: 'Org Member',
            source: 'oidc',
            wallets: [],
            organizationId: org.id
        });

        const result = await orgAwareService().createForWalletAssociation(
            testAddress,
            'login.acme.example.com',
            member.id
        );

        expect(result.msg).toContain('Associate this wallet with your AcmeChain account');
    });

    it("wallet-association challenge accepts the member org's domain even when SIWE login is disabled", async () => {
        // Association is a separate feature from wallet login: an OIDC-only org's members must still
        // be able to associate wallets from the org's own domain.
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweAllowedDomains: ['login.acme.example.com']
        });
        const member = await usersRepository.create({
            displayName: 'Org Member',
            source: 'oidc',
            wallets: [],
            organizationId: org.id
        });

        const result = await orgAwareService().createForWalletAssociation(
            testAddress,
            'login.acme.example.com',
            member.id
        );

        expect(result.msg).toContain('login.acme.example.com');
    });

    it("invalid-domain error does not disclose the org's private domain allowlist", async () => {
        const org = await repos.organizations.create({
            name: 'Acme Inc',
            defaultRoles: [],
            siweLoginEnabled: true,
            siweAllowedDomains: ['secret.acme.example.com']
        });

        const error: unknown = await orgAwareService()
            .createForLogin(
                { address: testAddress, domain: 'bogus.example.org', organizationId: org.id },
                fakeAuditLogContextForTests(auditLogsService)
            )
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidInputError);
        expect((error as InvalidInputError).message).not.toContain('secret.acme.example.com');
    });

    it('strips line breaks from a legacy brand name instead of failing challenge creation', async () => {
        // Rows written before write-time validation existed may hold CR/LF, which viem rejects in
        // EIP-4361 statements; the repo-level create bypasses the route schema like those rows did.
        const org = await repos.organizations.create({
            name: 'Legacy Inc',
            brandName: 'Acme\nChain',
            defaultRoles: []
        });

        const result = await orgAwareService().createForLogin(
            { address: testAddress, domain: 'example.com', organizationId: org.id },
            fakeAuditLogContextForTests(auditLogsService)
        );

        expect(result.msg).toContain('Login to Acme Chain chain');
    });
});
