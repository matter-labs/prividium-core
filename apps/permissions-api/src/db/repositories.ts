import type { DbOrTx, RawTxType } from '../db';
import { ApiKeysRepository } from '../repositories/api-keys-repository';
import { ApplicationsRepository } from '../repositories/applications-repository';
import { AuditLogsRepository } from '../repositories/audit-logs-repository';
import { BaseRepository } from '../repositories/base-repository';
import { ContractDeploymentsRepository } from '../repositories/contract-deployments-repository';
import { ContractEventsPermissionsRepository } from '../repositories/contract-events-permissions-repository';
import { ContractFunctionPermissionsRepository } from '../repositories/contract-function-permissions-repository';
import { ContractsRepository } from '../repositories/contracts-repository';
import { FaucetClaimsRepository } from '../repositories/faucet-claims-repository';
import { IpWhitelistRepository } from '../repositories/ip-whitelist-repository';
import { M2mApplicationsRepository } from '../repositories/m2m-applications-repository';
import { OidcProvidersRepository } from '../repositories/oidc-providers-repository';
import { OrgPendingAdminsRepository } from '../repositories/org-pending-admins-repository';
import { OrganizationsRepository } from '../repositories/organizations-repository';
import { PasskeyChallengesRepository } from '../repositories/passkey-challenges-repository';
import { PasskeyCredentialsRepository } from '../repositories/passkey-credentials-repository';
import { RolesRepository } from '../repositories/roles-repository';
import { ServicesRepository } from '../repositories/services-repository';
import { SessionsRepository } from '../repositories/sessions-repository';
import { SiweChallengeLogRepository } from '../repositories/siwe-challenge-log-repository';
import { SiweConsumedNoncesRepository } from '../repositories/siwe-consumed-nonces-repository';
import { StepUpProofsRepository } from '../repositories/step-up-proofs-repository';
import { TemplatePermissionsRepository } from '../repositories/template-permissions-repository';
import { TemplatesRepository } from '../repositories/templates-repository';
import { TenantsRepository } from '../repositories/tenants-repository';
import { UsersRepository } from '../repositories/users-repository';
import { WalletTransactionAllowancesRepository } from '../repositories/wallet-transaction-allowances-repository';

/** A Drizzle transaction augmented with a `repositories()` convenience method. */
export type TxType = RawTxType & {
    repositories(): Repositories;
};

/**
 * A factory that instantiates repositories bound to a `DbOrTx`.
 * Repository instances are cached per `Repositories` instance.
 *
 * For authenticated requests, `request.repos` is a `Repositories` instance
 * backed by a dedicated `PoolClient` whose session-level audit vars
 * (`app.trace_id`, `app.actor_id`, …) were set by `createAuditContextMiddleware`.
 * Every Postgres trigger fired by any transaction on that connection can read
 * full actor/trace context via `current_setting('app.*')`.
 */
export class Repositories {
    private readonly _cache = new Map<abstract new (...args: never[]) => unknown, unknown>();

    constructor(readonly db: DbOrTx) {}

    private _repo<T>(ctor: abstract new (...args: never[]) => T, factory: () => T): T {
        if (!this._cache.has(ctor)) {
            this._cache.set(ctor, factory());
        }
        return this._cache.get(ctor) as T;
    }

    /**
     * Runs `fn` inside a transaction, passing a `TxType` so that
     * `tx.repositories()` returns repositories already bound to that transaction.
     */
    transaction<T>(fn: (tx: TxType) => Promise<T>): Promise<T> {
        return this.db.transaction((rawTx: RawTxType) => {
            const tx = Object.assign(rawTx, {
                repositories: () => new Repositories(tx)
            }) as TxType;
            return fn(tx);
        });
    }

    get applications(): ApplicationsRepository {
        return this._repo(ApplicationsRepository, () => new ApplicationsRepository(this.db));
    }

    get auditLogs(): AuditLogsRepository {
        return this._repo(AuditLogsRepository, () => new AuditLogsRepository(this.db));
    }

    get contractDeployments(): ContractDeploymentsRepository {
        return this._repo(ContractDeploymentsRepository, () => new ContractDeploymentsRepository(this.db));
    }

    get contractEventsPermissions(): ContractEventsPermissionsRepository {
        return this._repo(ContractEventsPermissionsRepository, () => new ContractEventsPermissionsRepository(this.db));
    }

    get contractFunctionPermissions(): ContractFunctionPermissionsRepository {
        return this._repo(
            ContractFunctionPermissionsRepository,
            () => new ContractFunctionPermissionsRepository(this.db)
        );
    }

    get contracts(): ContractsRepository {
        return this._repo(ContractsRepository, () => new ContractsRepository(this.db));
    }

    get faucetClaims(): FaucetClaimsRepository {
        return this._repo(FaucetClaimsRepository, () => new FaucetClaimsRepository(this.db));
    }

    get passkeyCredentials(): PasskeyCredentialsRepository {
        return this._repo(PasskeyCredentialsRepository, () => new PasskeyCredentialsRepository(this.db));
    }

    get roles(): RolesRepository {
        return this._repo(RolesRepository, () => new RolesRepository(this.db));
    }

    get services(): ServicesRepository {
        return this._repo(ServicesRepository, () => new ServicesRepository(this.db));
    }

    get sessions(): SessionsRepository {
        return this._repo(SessionsRepository, () => new SessionsRepository(this.db));
    }

    get templatePermissions(): TemplatePermissionsRepository {
        return this._repo(TemplatePermissionsRepository, () => new TemplatePermissionsRepository(this.db));
    }

    get templates(): TemplatesRepository {
        return this._repo(TemplatesRepository, () => new TemplatesRepository(this.db));
    }

    get ipWhitelist(): IpWhitelistRepository {
        return this._repo(IpWhitelistRepository, () => new IpWhitelistRepository(this.db));
    }

    get tenants(): TenantsRepository {
        return this._repo(TenantsRepository, () => new TenantsRepository(this.db));
    }

    get users(): UsersRepository {
        return this._repo(UsersRepository, () => new UsersRepository(this.db));
    }

    get walletTransactionAllowances(): WalletTransactionAllowancesRepository {
        return this._repo(
            WalletTransactionAllowancesRepository,
            () => new WalletTransactionAllowancesRepository(this.db)
        );
    }

    get passkeyChallenges(): PasskeyChallengesRepository {
        return this._repo(PasskeyChallengesRepository, () => new PasskeyChallengesRepository(this.db));
    }

    get apiKeys(): ApiKeysRepository {
        return this._repo(ApiKeysRepository, () => new ApiKeysRepository(this.db));
    }

    get m2mApps(): M2mApplicationsRepository {
        return this._repo(M2mApplicationsRepository, () => new M2mApplicationsRepository(this.db));
    }

    get organizations(): OrganizationsRepository {
        return this._repo(OrganizationsRepository, () => new OrganizationsRepository(this.db));
    }

    get oidcProviders(): OidcProvidersRepository {
        return this._repo(OidcProvidersRepository, () => new OidcProvidersRepository(this.db));
    }

    get orgPendingAdmins(): OrgPendingAdminsRepository {
        return this._repo(OrgPendingAdminsRepository, () => new OrgPendingAdminsRepository(this.db));
    }

    get siweChallengeLogs(): SiweChallengeLogRepository {
        return this._repo(SiweChallengeLogRepository, () => new SiweChallengeLogRepository(this.db));
    }

    get consumedNonces(): SiweConsumedNoncesRepository {
        return this._repo(SiweConsumedNoncesRepository, () => new SiweConsumedNoncesRepository(this.db));
    }

    get stepUpProofs(): StepUpProofsRepository {
        return this._repo(StepUpProofsRepository, () => new StepUpProofsRepository(this.db));
    }
}

// Wire up BaseRepository.transaction to augment raw Drizzle tx objects with
// repositories(). Done here (not in BaseRepository) to avoid a circular import.
BaseRepository.augmentTx = (rawTx: RawTxType) => {
    const tx = Object.assign(rawTx, {
        repositories: () => new Repositories(tx)
    }) as TxType;
    return tx;
};
