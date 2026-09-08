import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pino from 'pino';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db/repositories';
import { UserSources } from '../db/schema';
import { ForbiddenError } from '../utils/error-types';
import { JwtValidatorService } from './jwt-validator-service';

const ZONE_ISSUER = 'https://zone.issuer/';
const ZONE_AUD = 'zone-aud';
const ORG_ISSUER = 'https://org.issuer/';
const ORG_AUD = 'org-aud';

describe('JwtValidatorService', () => {
    let repos: Repositories;
    let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
    let jwks: ReturnType<typeof createLocalJWKSet>;

    beforeEach<Fixture>(async ({ db }) => {
        repos = new Repositories(db);

        keyPair = await generateKeyPair('RS256');
        const publicJwk = await exportJWK(keyPair.publicKey);
        jwks = createLocalJWKSet({ keys: [publicJwk] });
    });

    function makeService(multiOrgEnabled: boolean) {
        return new JwtValidatorService({
            oidcOpts: { iss: ZONE_ISSUER, aud: ZONE_AUD, jwks },
            logger: pino({ level: 'silent' }),
            repos,
            adminOidcSubs: [],
            multiOrgEnabled,
            jwksFactory: () => jwks
        });
    }

    function signJwt({ iss, aud, sub }: { iss: string; aud: string; sub: string }) {
        return new SignJWT({})
            .setProtectedHeader({ alg: 'RS256' })
            .setIssuer(iss)
            .setAudience(aud)
            .setSubject(sub)
            .sign(keyPair.privateKey);
    }

    async function seedOrgProvider(name: string, issuer: string, audience: string) {
        const org = await repos.organizations.create({ name, defaultRoles: [] });
        await repos.oidcProviders.create({
            organizationId: org.id,
            issuer,
            jwksUri: 'https://unused.test/jwks',
            audience,
            clientId: 'client'
        });
        return org;
    }

    it('creates a zone user (organizationId null) for a zone-issuer token', async () => {
        const jwt = await signJwt({ iss: ZONE_ISSUER, aud: ZONE_AUD, sub: 'zone-sub' });

        const { user } = await makeService(false).validateOidc({ jwt });

        expect(user.organizationId).toBeNull();
        expect(user.oidcSub).toBe('zone-sub');
    });

    it('rejects a token from an unknown issuer', async () => {
        const jwt = await signJwt({ iss: 'https://unknown.issuer/', aud: 'x', sub: 'sub' });

        await expect(makeService(true).validateOidc({ jwt })).rejects.toThrow();
    });

    it('rejects an org-issuer token when multi-org is disabled', async () => {
        await seedOrgProvider('Org', ORG_ISSUER, ORG_AUD);
        const jwt = await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' });

        await expect(makeService(false).validateOidc({ jwt })).rejects.toThrow();
    });

    it('creates an org-bound member on first org login when there is no pending admin', async () => {
        const org = await seedOrgProvider('Org', ORG_ISSUER, ORG_AUD);
        const jwt = await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'member-sub' });

        const { user } = await makeService(true).validateOidc({ jwt });

        expect(user.organizationId).toBe(org.id);
        expect(user.roles.some((r) => r.systemPermissions.includes('admin_write'))).toBe(false);
    });

    it('promotes the pending admin on first login and consumes the record', async () => {
        const org = await seedOrgProvider('Org', ORG_ISSUER, ORG_AUD);
        await repos.orgPendingAdmins.create({ organizationId: org.id, oidcSub: 'admin-sub' });
        const jwt = await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'admin-sub' });

        const { user } = await makeService(true).validateOidc({ jwt });

        expect(user.organizationId).toBe(org.id);

        const adminRole = user.roles.find(
            (r) =>
                r.organizationId === org.id &&
                r.systemPermissions.includes('admin_write') &&
                r.systemPermissions.includes('admin_read')
        );
        expect(adminRole).not.toBe(undefined);
        expect(adminRole?.roleName).toMatch(/Admin/);
        expect(await repos.orgPendingAdmins.findByOrganizationAndSub(org.id, 'admin-sub')).toBeUndefined();
    });

    it('does not duplicate the user on a second login', async () => {
        await seedOrgProvider('Org', ORG_ISSUER, ORG_AUD);
        const service = makeService(true);

        const first = await service.validateOidc({ jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' }) });
        const second = await service.validateOidc({
            jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' })
        });

        expect(second.user.id).toBe(first.user.id);
    });

    it('keeps org identities isolated: same sub from different issuers are distinct users', async () => {
        const orgA = await seedOrgProvider('Org A', 'https://a.issuer/', 'aud-a');
        const orgB = await seedOrgProvider('Org B', 'https://b.issuer/', 'aud-b');
        const service = makeService(true);

        const a = await service.validateOidc({
            jwt: await signJwt({ iss: 'https://a.issuer/', aud: 'aud-a', sub: 'shared' })
        });
        const b = await service.validateOidc({
            jwt: await signJwt({ iss: 'https://b.issuer/', aud: 'aud-b', sub: 'shared' })
        });

        expect(a.user.id).not.toBe(b.user.id);
        expect(a.user.organizationId).toBe(orgA.id);
        expect(b.user.organizationId).toBe(orgB.id);
    });

    it('rejects a token once its organization has been soft-deleted', async () => {
        const org = await seedOrgProvider('Org', ORG_ISSUER, ORG_AUD);
        const service = makeService(true);

        await service.validateOidc({ jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' }) });

        await repos.organizations.delete(org.id);

        await expect(
            service.validateOidc({ jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' }) })
        ).rejects.toThrow(ForbiddenError);
    });

    it('picks up a provider audience change without a restart', async () => {
        const org = await seedOrgProvider('Org', ORG_ISSUER, ORG_AUD);
        const service = makeService(true);

        // First login caches the provider opts for ORG_ISSUER (audience ORG_AUD).
        await service.validateOidc({ jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' }) });

        await repos.oidcProviders.upsert({
            organizationId: org.id,
            issuer: ORG_ISSUER,
            jwksUri: 'https://unused.test/jwks',
            audience: 'tightened-aud',
            clientId: 'client'
        });

        // Tokens for the old audience are now rejected, and tokens for the new audience are accepted.
        await expect(
            service.validateOidc({ jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' }) })
        ).rejects.toThrow();
        const after = await service.validateOidc({
            jwt: await signJwt({ iss: ORG_ISSUER, aud: 'tightened-aud', sub: 'sub' })
        });
        expect(after.user.organizationId).toBe(org.id);
    });

    it('rebuilds the JWKS set when the provider jwksUri rotates', async () => {
        const org = await seedOrgProvider('Org', ORG_ISSUER, ORG_AUD);
        const jwksUris: string[] = [];
        const service = new JwtValidatorService({
            oidcOpts: { iss: ZONE_ISSUER, aud: ZONE_AUD, jwks },
            logger: pino({ level: 'silent' }),
            repos,
            adminOidcSubs: [],
            multiOrgEnabled: true,
            jwksFactory: (uri) => {
                jwksUris.push(uri);
                return jwks;
            }
        });

        // Two logins against the same provider reuse the cached JWKS set (factory called once).
        await service.validateOidc({ jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' }) });
        await service.validateOidc({ jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' }) });
        expect(jwksUris).toEqual(['https://unused.test/jwks']);

        await repos.oidcProviders.upsert({
            organizationId: org.id,
            issuer: ORG_ISSUER,
            jwksUri: 'https://rotated.test/jwks',
            audience: ORG_AUD,
            clientId: 'client'
        });

        await service.validateOidc({ jwt: await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' }) });
        expect(jwksUris).toEqual(['https://unused.test/jwks', 'https://rotated.test/jwks']);
    });

    it('claims a pre-existing user that has no issuer on login instead of duplicating it', async () => {
        const created = await repos.users.create({
            oidcSub: 'legacy-sub',
            displayName: 'Legacy User',
            source: UserSources.enum.oidc
        });
        expect(created.oidcIssuer).toBeNull();

        const { user } = await makeService(false).validateOidc({
            jwt: await signJwt({ iss: ZONE_ISSUER, aud: ZONE_AUD, sub: 'legacy-sub' })
        });

        expect(user.id).toBe(created.id);
        expect(user.oidcIssuer).toBe(ZONE_ISSUER);
    });

    describe('organizationIdForJwt', () => {
        it('returns the org for a token claiming a configured org issuer', async () => {
            const org = await seedOrgProvider('Claim Org', ORG_ISSUER, ORG_AUD);
            const jwt = await signJwt({ iss: ORG_ISSUER, aud: ORG_AUD, sub: 'sub' });
            expect(await makeService(true).organizationIdForJwt(jwt)).toBe(org.id);
        });

        it('returns null for the zone issuer', async () => {
            const jwt = await signJwt({ iss: ZONE_ISSUER, aud: ZONE_AUD, sub: 'sub' });
            expect(await makeService(true).organizationIdForJwt(jwt)).toBeNull();
        });

        it('returns null for an unknown or unreadable issuer', async () => {
            const unknown = await signJwt({ iss: 'https://unknown.issuer/', aud: 'x', sub: 'sub' });
            expect(await makeService(true).organizationIdForJwt(unknown)).toBeNull();
            expect(await makeService(true).organizationIdForJwt('not-a-jwt')).toBeNull();
        });
    });
});
