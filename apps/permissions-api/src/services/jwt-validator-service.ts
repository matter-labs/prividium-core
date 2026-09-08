import { ADMIN_ROLE_ID } from '@repo/access-control';
import { createRemoteJWKSet, decodeJwt, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { JWTClaimValidationFailed, JWTExpired } from 'jose/errors';
import { type ZodType, z } from 'zod/v4';
import type { Repositories } from '../db';
import { UserSources } from '../db/schema';
import type { OidcProvider } from '../repositories/oidc-providers-repository';
import type { User } from '../repositories/users-repository';
import { ForbiddenError } from '../utils/error-types';
import type { PinoLogger } from '../utils/logger';

const JWKS_TIMEOUT_MS = 15000;

export type JwksFactory = (jwksUri: string) => JWTVerifyGetKey;

// jwksUri comes from operator-configured organization provider records; its URL is validated at
// provider-configuration time, not here.
const buildRemoteJwks: JwksFactory = (jwksUri) =>
    createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: JWKS_TIMEOUT_MS }); // nosemgrep: prividium-ssrf-jwks-remote-fetch

export class JwtValidatorService {
    private zoneOidcOpts?: JwtValidationData;
    private logger: PinoLogger;
    private repos: Repositories;
    private adminOidcSubs: string[];
    private multiOrgEnabled: boolean;
    private jwksFactory: JwksFactory;
    private providerOptsCache = new Map<string, CachedProviderOpts>();

    constructor({
        oidcOpts,
        logger,
        repos,
        adminOidcSubs,
        multiOrgEnabled,
        jwksFactory
    }: {
        oidcOpts?: JwtValidationData;
        logger: PinoLogger;
        repos: Repositories;
        adminOidcSubs: string[];
        multiOrgEnabled: boolean;
        jwksFactory?: JwksFactory;
    }) {
        this.zoneOidcOpts = oidcOpts;
        this.logger = logger;
        this.repos = repos;
        this.adminOidcSubs = adminOidcSubs;
        this.multiOrgEnabled = multiOrgEnabled;
        this.jwksFactory = jwksFactory ?? buildRemoteJwks;
    }

    async validateOidc({ jwt }: { jwt: string }) {
        const { opts, organizationId } = await this.resolveProvider(this.peekIssuer(jwt));
        const data = await this.verifyJwt(jwt, opts, oidcJwtSchema);

        let user: User | undefined = await this.repos.users.findByIssuerAndSub(data.iss, data.sub);
        if (!user) {
            user =
                (await this.claimUnissuedUser({ data, organizationId })) ??
                (await this.bootstrapOrCreateUser({ jwt: data, organizationId }));
        } else if (this.multiOrgEnabled && user.organizationId !== organizationId) {
            this.logger.warn({ userId: user.id }, 'OIDC token issuer maps to a different organization than the user');
            throw new ForbiddenError();
        }

        user = await this.autoAssignAdminRole({ user, organizationId });
        await this.updateOidcDisplayName({ user, jwt: data });

        // Re-read with full roles so callers can evaluate system permissions (e.g. MFA enforcement).
        const userWithRoles = await this.repos.users.findByIdWithRoles(user.id);
        if (!userWithRoles) throw new Error('User was not found after OIDC validation');

        return {
            user: userWithRoles,
            sub: data.sub,
            iss: data.iss
        };
    }

    // Resolves the org from the token's UNVERIFIED issuer — used only to attribute a failed login attempt.
    async organizationIdForJwt(jwt: string): Promise<string | null> {
        try {
            const { organizationId } = await this.resolveProvider(this.peekIssuer(jwt));
            return organizationId;
        } catch {
            return null;
        }
    }

    // The zone operator provider (from env) always owns the zone issuer, so an organization can never
    // claim it. Routing is by the unverified issuer claim only; signature/issuer/audience are still
    // verified against the resolved provider in verifyJwt.
    private async resolveProvider(issuer: string): Promise<{ opts: JwtValidationData; organizationId: string | null }> {
        if (this.zoneOidcOpts && this.zoneOidcOpts.iss === issuer) {
            return { opts: this.zoneOidcOpts, organizationId: null };
        }

        if (this.multiOrgEnabled) {
            const provider = await this.repos.oidcProviders.getByIssuer(issuer);
            if (provider) {
                return { opts: this.providerOpts(provider), organizationId: provider.organizationId };
            }
        }

        this.logger.debug({ issuer }, 'No OIDC provider configured for issuer');
        throw new ForbiddenError();
    }

    private providerOpts(provider: OidcProvider): JwtValidationData {
        // The provider is re-read from the DB on every request, so reuse the cached remote JWKS set only
        // while it still reflects the stored record. An operator rotating jwksUri or audience via
        // PUT /organizations/:id/oidc-provider is then picked up on the next request without a restart.
        const cached = this.providerOptsCache.get(provider.issuer);
        if (cached && cacheReflectsProvider(cached, provider)) {
            return cached.opts;
        }
        const opts: JwtValidationData = {
            iss: provider.issuer,
            aud: provider.audience,
            jwks: this.jwksFactory(provider.jwksUri)
        };
        this.providerOptsCache.set(provider.issuer, { jwksUri: provider.jwksUri, opts });
        return opts;
    }

    private peekIssuer(jwt: string): string {
        try {
            // Reads the issuer only to route to a provider; jwtVerify checks the signature afterwards.
            const issuer = decodeJwt(jwt).iss; // nosemgrep: prividium-jwt-security-decode-without-verify
            if (typeof issuer !== 'string') {
                throw new Error('missing issuer claim');
            }
            return issuer;
        } catch (err) {
            this.logger.debug({ err }, 'Could not read issuer from jwt');
            throw new ForbiddenError();
        }
    }

    private async verifyJwt<Schema extends ZodType>(
        jwt: string,
        opts: JwtValidationData,
        schema: Schema
    ): Promise<z.infer<Schema>> {
        let jwtData: Awaited<ReturnType<typeof jwtVerify>>;
        try {
            jwtData = await jwtVerify(jwt, opts.jwks, {
                issuer: opts.iss,
                audience: opts.aud,
                algorithms: ['RS256']
            });
        } catch (err) {
            if (!knownJoseErrors.some((klass) => err instanceof klass)) {
                this.logger.warn({ err }, 'Unknown error validating jwt');
            }

            this.logger.debug({ err }, 'Error validating jwt');
            throw new ForbiddenError();
        }

        const parsed = schema.safeParse(jwtData.payload);
        if (!parsed.success) {
            this.logger.debug({ err: parsed.error }, 'Error parsing jwt data');
            throw new ForbiddenError();
        }

        return parsed.data;
    }

    private resolveOidcDisplayName(jwt: OidcJwt): string {
        return jwt.preferred_username ?? jwt.email ?? jwt.sub;
    }

    // A user provisioned before its issuer was recorded (backfilled-after-creation, or created out-of-band
    // by an M2M/admin flow) carries a null issuer. On first login, stamp the verified issuer onto that same
    // organization's account instead of creating a duplicate, so (issuer, sub) matching finds it thereafter.
    private async claimUnissuedUser({
        data,
        organizationId
    }: {
        data: OidcJwt;
        organizationId: string | null;
    }): Promise<User | undefined> {
        const existing = await this.repos.users.findByOidcSub(data.sub);
        if (!existing || existing.oidcIssuer !== null) {
            return undefined;
        }
        if (this.multiOrgEnabled && existing.organizationId !== organizationId) {
            return undefined;
        }
        await this.repos.users.setOidcIssuer(existing.id, data.iss);
        return this.repos.users.findById(existing.id);
    }

    private async bootstrapOrCreateUser({
        jwt,
        organizationId
    }: {
        jwt: OidcJwt;
        organizationId: string | null;
    }): Promise<User> {
        if (organizationId === null) {
            return this.repos.users.create({
                oidcSub: jwt.sub,
                oidcIssuer: jwt.iss,
                displayName: this.resolveOidcDisplayName(jwt),
                wallets: [],
                roles: [],
                source: UserSources.enum.oidc
            });
        }

        // Promote and consume the pending-admin slot in one transaction so it can't be used twice.
        return this.repos.transaction(async (tx) => {
            const txRepos = tx.repositories();
            const pending = await txRepos.orgPendingAdmins.findByOrganizationAndSub(organizationId, jwt.sub);
            // Only a pending admin needs the org admin role; resolving it lazily for every member's
            // first login would needlessly create the role and widen the concurrent-create window.
            const roles = pending ? [(await txRepos.roles.orgAdminRole(organizationId)).id] : [];
            const user = await txRepos.users.create({
                oidcSub: jwt.sub,
                oidcIssuer: jwt.iss,
                displayName: this.resolveOidcDisplayName(jwt),
                wallets: [],
                roles,
                source: UserSources.enum.oidc,
                organizationId
            });
            if (pending) {
                await txRepos.orgPendingAdmins.deleteById(pending.id);
            }
            return user;
        });
    }

    private async autoAssignAdminRole({ user, organizationId }: { user: User; organizationId: string | null }) {
        // Zone-admin elevation (OIDC_ADMIN_SUBS) applies only to zone users, never organization users.
        if (organizationId !== null) {
            return user;
        }
        if (
            user.oidcSub !== null &&
            this.adminOidcSubs.includes(user.oidcSub) &&
            user.roles.every((r) => r.id !== ADMIN_ROLE_ID)
        ) {
            await this.repos.users.update(
                user.id,
                { ...user, roles: [...user.roles.map((r) => r.id), ADMIN_ROLE_ID], wallets: undefined },
                { allowZoneRoles: !this.multiOrgEnabled }
            );
            // Refresh user to get the updated roles
            const updatedUser = await this.repos.users.findById(user.id);
            if (!updatedUser) throw new Error('User was not found during auto-assign admin role');
            return updatedUser;
        }

        return user;
    }

    private async updateOidcDisplayName({ user, jwt }: { user: User; jwt: OidcJwt }) {
        const resolved = this.resolveOidcDisplayName(jwt);
        if (user.displayName !== resolved) {
            await this.repos.users.update(user.id, { displayName: resolved });
        }
    }
}

export interface JwtValidationData {
    iss: string;
    aud: string;
    jwks: JWTVerifyGetKey;
}

// Validation opts plus the source jwksUri, so a cached entry can be checked against the current record.
interface CachedProviderOpts {
    jwksUri: string;
    opts: JwtValidationData;
}

// A cached JWKS set stays valid only while the provider's verification inputs (jwksUri, audience) are
// unchanged; the issuer is the cache key so it cannot differ here.
function cacheReflectsProvider(cached: CachedProviderOpts, provider: OidcProvider): boolean {
    return cached.jwksUri === provider.jwksUri && cached.opts.aud === provider.audience;
}

const oidcJwtSchema = z.object({
    sub: z.string(),
    iss: z.string(),
    email: z.string().optional(),
    preferred_username: z.string().optional()
});

type OidcJwt = z.infer<typeof oidcJwtSchema>;

const knownJoseErrors = [JWTClaimValidationFailed, JWTExpired];
