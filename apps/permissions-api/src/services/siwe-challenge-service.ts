import { ADMIN_ROLE_ID } from '@repo/access-control';
import { addMilliseconds, getUnixTime, subSeconds } from 'date-fns';
import type { Address } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import type { Repositories, TxType } from '../db';
import { type TargetType, TargetTypes } from '../db/schema';
import type { Organization } from '../repositories/organizations-repository';
import { secureRandomString } from '../utils/crypto';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError, RateLimitError } from '../utils/error-types';
import { isSiweCompatibleDomain } from '../utils/siwe-domain';
import type { AuditLogContext } from './audit-logs-service';
import type { SiweService } from './siwe-service';

export type CreateSiweMessage = {
    address: Address;
    domain?: string;
    organizationId?: string;
};

export type CreateTenantSiweMessage = {
    address: Address;
};

export type CreateServiceSiweMessage = {
    address: Address;
};

export type SiweChallenge = {
    nonce: string;
    msg: string;
    nonceToken: string;
};

// Brand + extra valid SIWE domains an org-scoped challenge resolves to; the zone context has no extras.
type OrgSiweContext = {
    brandName: string;
    extraValidDomains: string[];
};

const TENANT_STATEMENT = 'Access to tenant api';

type Deps = {
    repos: Repositories;
    expirationDeltaMs: number;
    chainId: number;
    validDomains: string[];
    adminWallets: string[];
    challengeRateLimitCount: number;
    challengeRateLimitWindowSeconds: number;
    rateLimitBypassIps: string[];
    siweService: SiweService;
    brandName: string;
    multiOrgEnabled: boolean;
};

export class SiweChallengeService {
    private readonly repos: Repositories;
    private expirationDeltaMs: number;
    private chainId: number;
    private validDomains: string[];
    private adminWallets: string[];
    private challengeRateLimitCount: number;
    private challengeRateLimitWindowSeconds: number;
    private rateLimitBypassIps: string[];
    private siweService: SiweService;
    private readonly brandName: string;
    private readonly multiOrgEnabled: boolean;

    constructor(deps: Deps) {
        this.repos = deps.repos;
        this.expirationDeltaMs = deps.expirationDeltaMs;
        this.chainId = deps.chainId;
        this.validDomains = deps.validDomains;
        this.adminWallets = deps.adminWallets;
        this.challengeRateLimitCount = deps.challengeRateLimitCount;
        this.challengeRateLimitWindowSeconds = deps.challengeRateLimitWindowSeconds;
        this.rateLimitBypassIps = deps.rateLimitBypassIps;
        this.siweService = deps.siweService;
        this.brandName = deps.brandName;
        this.multiOrgEnabled = deps.multiOrgEnabled;
    }

    async createForWalletAssociation(
        address: Address,
        domain: string,
        userId: string,
        clientIp?: string
    ): Promise<SiweChallenge> {
        return this.repos.transaction(async (tx) => {
            const txRepos = tx.repositories();
            await this.insertChallengeLog(tx, address, TargetTypes.enum.user, clientIp);

            // Association is authenticated, so the org context comes from the user's own membership —
            // never from client input. That trust also means the org's domains are accepted regardless
            // of the wallet-login toggle: association is a separate feature (RPC access for OIDC-only
            // orgs), and its domains are the org's own admin-configured signing pages.
            const user = await txRepos.users.findById(userId);
            const orgContext = await this.resolveOrgSiweContext(txRepos, user?.organizationId, {
                domainsRequireSiweLoginEnabled: false
            });

            const nonce = secureRandomString();
            const msg = this.message(
                address,
                domain,
                nonce,
                `Associate this wallet with your ${orgContext.brandName} account`,
                orgContext.extraValidDomains
            );
            return {
                nonce,
                msg,
                nonceToken: this.createNonceToken({
                    address,
                    nonce,
                    msg,
                    targetType: TargetTypes.enum.user,
                    targetId: userId
                })
            };
        });
    }

    async createForLogin(
        message: CreateSiweMessage,
        _operationContext: AuditLogContext,
        clientIp?: string
    ): Promise<SiweChallenge> {
        const { address, domain, organizationId } = message;
        const resolvedDomain = domain ?? this.validDomains[0];
        if (!resolvedDomain) {
            throw new InvalidInputError('No valid SIWE domains configured. Please set SIWE_VALID_DOMAINS.');
        }

        return this.repos.transaction(async (tx) => {
            const txRepos = tx.repositories();
            await this.insertChallengeLog(tx, address, TargetTypes.enum.user, clientIp);

            // After insertChallengeLog so the org lookup sits behind the challenge rate limit
            // (this endpoint is anonymous).
            const orgContext = await this.resolveOrgSiweContext(txRepos, organizationId, {
                domainsRequireSiweLoginEnabled: true
            });
            const statement = `Login to ${orgContext.brandName} chain`;

            let targetUserId = await this.findWalletUserId(tx, address);
            // If no user found for this wallet, check if it's an admin wallet
            if (!targetUserId && this.adminWallets.some((wallet) => wallet.toLowerCase() === address.toLowerCase())) {
                targetUserId = await this.ensureAdminWalletUser(tx, txRepos, address);
            }

            const nonce = secureRandomString();
            const msg = this.message(address, resolvedDomain, nonce, statement, orgContext.extraValidDomains);
            return {
                nonce,
                msg,
                nonceToken: this.createNonceToken({
                    address,
                    nonce,
                    msg,
                    targetType: TargetTypes.enum.user,
                    targetId: targetUserId
                })
            };
        });
    }

    private async findWalletUserId(tx: TxType, address: Address): Promise<string | null> {
        const wallet = await tx.query.walletsTable.findFirst({
            columns: { userId: true },
            where: (f, { eq, and, isNull }) => and(eq(f.walletAddress, address), isNull(f.deletedAt))
        });
        return wallet?.userId ?? null;
    }

    // A concurrent first login for the same wallet can win the insert after the check above.
    // `users.create` nests a savepoint, so that conflict does not abort this transaction.
    private async ensureAdminWalletUser(tx: TxType, repos: Repositories, address: Address): Promise<string> {
        try {
            const user = await repos.users.create({
                displayName: 'Admin Wallet',
                source: 'crypto_native',
                wallets: [address],
                roles: [ADMIN_ROLE_ID]
            });
            return user.id;
        } catch (error) {
            if (!(error instanceof EntityAlreadyExistsError)) {
                throw error;
            }
            const winnerUserId = await this.findWalletUserId(tx, address);
            if (!winnerUserId) {
                throw error;
            }
            return winnerUserId;
        }
    }

    private zoneContext(): OrgSiweContext {
        return { brandName: this.brandName, extraValidDomains: [] };
    }

    // On the login path the org id comes from the login page's ?org, not a verified signer, so an
    // unknown id silently falls back to the zone context; gated on MULTI_ORG_ENABLED to prevent org
    // probing. Login gates the org's domains on the zone admin's toggle (domainsRequireSiweLoginEnabled);
    // association trusts the authenticated member's org and does not.
    private async resolveOrgSiweContext(
        repos: Repositories,
        organizationId: string | null | undefined,
        { domainsRequireSiweLoginEnabled }: { domainsRequireSiweLoginEnabled: boolean }
    ): Promise<OrgSiweContext> {
        if (!this.multiOrgEnabled || !organizationId) {
            return this.zoneContext();
        }

        let org: Organization;
        try {
            org = await repos.organizations.getById(organizationId);
        } catch (error) {
            if (error instanceof EntityNotFound) {
                return this.zoneContext();
            }
            throw error;
        }

        const domainsApply = org.siweLoginEnabled || !domainsRequireSiweLoginEnabled;
        return {
            // Rows written before line-break validation existed may still hold CR/LF, which viem
            // rejects in EIP-4361 statements — strip rather than 500 at challenge creation.
            brandName: (org.brandName ?? '').replace(/[\r\n]+/g, ' ').trim() || this.brandName,
            extraValidDomains: domainsApply ? await this.orgValidDomains(repos, org.id, org.siweAllowedDomains) : []
        };
    }

    private async orgValidDomains(
        repos: Repositories,
        organizationId: string,
        allowedDomains: string[]
    ): Promise<string[]> {
        const domains = [...allowedDomains];
        const provider = await repos.oidcProviders.findById(organizationId);
        if (provider?.userPanelUrl) {
            try {
                // Same probe the allowlist runs at write time: a SIWE-incompatible host (e.g. a
                // single-label hostname) must be skipped here or createSiweMessage would 500 later.
                const host = new URL(provider.userPanelUrl).host;
                if (isSiweCompatibleDomain(host)) {
                    domains.push(host);
                }
            } catch {
                // Pre-validation rows may hold a malformed URL; the explicit allowlist still applies.
            }
        }
        return domains;
    }

    private message(
        address: Address,
        domain: string,
        nonce: string,
        statement: string,
        extraValidDomains: string[] = []
    ): string {
        if (!this.validDomains.includes(domain) && !extraValidDomains.includes(domain)) {
            // Only the zone domains are enumerated: this error reaches unauthenticated callers, so org
            // entries are never echoed back. They are not fully private, though — accept/reject still
            // confirms a guessed entry one domain at a time, and the rate limit keys on the
            // caller-supplied address, so treat allowlist entries as unlisted, not secret.
            throw new InvalidInputError(
                `Invalid domain: "${domain}". Valid values are: ${this.validDomains.join(', ')}`
            );
        }

        // uri is a protocol identifier, not a brand string — intentionally not configurable
        return createSiweMessage({
            address,
            nonce,
            domain,
            chainId: this.chainId,
            uri: 'prividium:access',
            version: '1',
            statement,
            expirationTime: addMilliseconds(new Date(), this.expirationDeltaMs)
        });
    }

    async createForTenant(data: CreateTenantSiweMessage, clientIp?: string): Promise<SiweChallenge> {
        return this.repos.transaction(async (tx) => {
            await this.insertChallengeLog(tx, data.address, TargetTypes.enum.tenant, clientIp);
            const nonce = secureRandomString();
            const msg = this.message(data.address, this.validDomains[0]!, nonce, TENANT_STATEMENT);
            return {
                nonce,
                msg,
                nonceToken: this.createNonceToken({
                    address: data.address,
                    nonce,
                    msg,
                    targetType: TargetTypes.enum.tenant,
                    targetId: null
                })
            };
        });
    }

    async createForService(data: CreateServiceSiweMessage, clientIp?: string): Promise<SiweChallenge> {
        return this.repos.transaction(async (tx) => {
            await this.insertChallengeLog(tx, data.address, TargetTypes.enum.service, clientIp);
            const nonce = secureRandomString();
            const msg = this.message(
                data.address,
                this.validDomains[0]!,
                nonce,
                `Service access to ${this.brandName} chain`
            );
            return {
                nonce,
                msg,
                nonceToken: this.createNonceToken({
                    address: data.address,
                    nonce,
                    msg,
                    targetType: TargetTypes.enum.service,
                    targetId: null
                })
            };
        });
    }

    private async insertChallengeLog(
        tx: TxType,
        address: Address,
        targetType: TargetType,
        clientIp?: string
    ): Promise<void> {
        const txRepos = tx.repositories();
        if (!clientIp || !this.rateLimitBypassIps.includes(clientIp)) {
            const windowStart = subSeconds(new Date(), this.challengeRateLimitWindowSeconds);
            const challengesInWindow = await txRepos.siweChallengeLogs.countSince(address, windowStart);
            if (challengesInWindow >= this.challengeRateLimitCount) {
                throw new RateLimitError('Too many SIWE challenges requested. Please wait a moment before continuing.');
            }
        }
        await txRepos.siweChallengeLogs.insert(address, targetType);
    }

    private createNonceToken({
        address,
        nonce,
        msg,
        targetType,
        targetId
    }: {
        address: Address;
        nonce: string;
        msg: string;
        targetType: TargetType;
        targetId: string | null;
    }): string {
        const now = new Date();
        const issuedAt = getUnixTime(now);
        const expiration = getUnixTime(addMilliseconds(now, this.expirationDeltaMs));
        return this.siweService.generateNonceToken({
            address,
            nonce,
            targetType,
            targetId,
            exp: expiration,
            iat: issuedAt,
            message: msg
        });
    }
}
