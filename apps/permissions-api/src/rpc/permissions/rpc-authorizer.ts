import {
    hasAnySystemPermission,
    hasSystemPermission,
    type RoleHolder,
    sequencerAccessControl
} from '@repo/access-control';
import type { Address, Hex } from 'viem';
import type { Repositories } from '../../db';
import type { MethodAccessType } from '../../db/schema';
import type { AuthData } from '../../middleware/auth-data';
import type { SystemPermission } from '../../permissions/system-permissions';
import type { ContractDeployment } from '../../repositories/contract-deployments-repository';
import type { Contract } from '../../repositories/contracts-repository';
import type { AuthorizationResult, MethodAuthorizer } from '../../services/authorization-service';
import type { EventPermissionVerifier } from '../../services/event-permission-verifier';
import { EntityNotFound } from '../../utils/error-types';
import { areHexEqual } from '../../utils/hex';
import type { PinoLogger } from '../../utils/logger';
import { AddressSet } from '../address-set';
import { ForbiddenRpcError, UnauthorizedRpcError } from '../errors';
import type { GetLogsFilter } from '../methods/handlers';
import type { ExternalRpc } from '../target-rpc';
import type { Authorizer, DeploymentAuthorization, DisclosureConfig, LogData } from './authorizer';

export class RpcAuthorizer implements Authorizer {
    private auth: AuthData;
    private methodAuthService: MethodAuthorizer;
    private repos: Repositories;
    private eventVerifier: EventPermissionVerifier;
    private targetRpc: ExternalRpc;
    private logger: PinoLogger;
    private requestId: string | undefined;
    private _associatedAddresses: AddressSet | null;

    // This object lives only for a single request. The main goal of this cache is
    // to minimize queries when filtering transactions in a block. No need to worry about cache eviction
    private _contracts: Map<string, Contract | null>;
    private _contractOrgs: Map<string, string | null>;

    constructor(
        auth: AuthData,
        methodAuthService: MethodAuthorizer,
        repos: Repositories,
        eventVerifier: EventPermissionVerifier,
        targetRpc: ExternalRpc,
        logger: PinoLogger,
        requestId?: string
    ) {
        this.auth = auth;
        this.methodAuthService = methodAuthService;
        this.repos = repos;
        this.eventVerifier = eventVerifier;
        this.targetRpc = targetRpc;
        this.logger = logger;
        this.requestId = requestId;
        this._associatedAddresses = null;
        this._contracts = new Map();
        this._contractOrgs = new Map();
    }

    /**
     * Contract call authorization (eth_call, eth_estimateGas, eth_sendRawTransaction).
     * For all auth types, the individual user's roles are checked against the method permission.
     *   - user: checks the user's roles directly.
     *   - tenant: finds user by `from` address within tenant, checks that user's roles.
     *   - m2m_app: requires `org_rpc_access`, finds user by `from` address within
     *     linked orgs, checks that user's roles.
     */
    async checkContractAccess(
        from: Address | undefined,
        to: Address,
        callData: Hex,
        access: MethodAccessType,
        rpcMethod: string
    ): Promise<AuthorizationResult> {
        if (from === undefined) {
            throw new ForbiddenRpcError('eth_call always has to specify from address');
        }

        return this.auth.dispatch(
            {
                user: () =>
                    this.methodAuthService.checkMethodAuthorizationForUser({
                        fromAddress: from,
                        contractAddress: to,
                        user: this.auth.currentUser(),
                        calldata: callData,
                        accessTypeCheck: access,
                        rpcMethod,
                        requestId: this.requestId
                    }),
                tenant: () =>
                    this.methodAuthService.checkForTenant(this.auth.currentTenant().id, from, to, callData, access, {
                        rpcMethod,
                        requestId: this.requestId
                    }),
                m2m_app: async () => {
                    const m2mApp = this.auth.currentM2mApp();
                    if (!hasSystemPermission(m2mApp, 'org_rpc_access')) {
                        return { authorized: false, ruleId: 'm2m.rpc_access_missing' } satisfies AuthorizationResult;
                    }

                    const user = await this.repos.m2mApps.findUserByAddressForApp(m2mApp.id, from);
                    if (!user) {
                        return { authorized: false, ruleId: 'm2m.user_not_found' } satisfies AuthorizationResult;
                    }

                    return this.methodAuthService.checkMethodAuthorizationForUser({
                        fromAddress: from,
                        contractAddress: to,
                        user,
                        calldata: callData,
                        accessTypeCheck: access,
                        rpcMethod,
                        requestId: this.requestId
                    });
                }
            },
            new UnauthorizedRpcError(
                `Invalid authentication type. Expected user, tenant or m2m_app, found ${this.auth.type}`
            )
        );
    }

    /**
     * Collects all wallet addresses the caller has visibility over.
     * Used by eth_getLogs pre-flight (couldQueryMatchPermissions) and address ownership checks.
     *   - user: the user's own wallets.
     *   - tenant: all wallets of users linked to the tenant.
     *   - m2m_app: requires `org_rpc_access`, all wallets of users in linked orgs.
     */
    async associatedAddresses(): Promise<AddressSet> {
        if (this._associatedAddresses === null) {
            const addresses = await this.auth.dispatch(
                {
                    user: () => Promise.resolve(this.auth.currentUser().wallets.map((w) => w.walletAddress)),
                    tenant: () => this.repos.tenants.allAssociatedWallets(this.auth.currentTenant().id),
                    m2m_app: async () => {
                        if (!hasSystemPermission(this.auth.currentM2mApp(), 'org_rpc_access')) {
                            return [];
                        }

                        return this.repos.m2mApps.findAllWalletAddressesForApp(this.auth.currentM2mApp().id);
                    }
                },
                new UnauthorizedRpcError(
                    `Invalid authentication type. Expected user, tenant or m2m_app, found ${this.auth.type}`
                )
            );
            this._associatedAddresses = new AddressSet(addresses);
        }

        return this._associatedAddresses;
    }

    /**
     * Runs before the upstream call: candidates come from the response, so without this an
     * unauthenticated request would still reach the target RPC.
     * @throws UnauthorizedRpcError when the principal is not a user, tenant or m2m app
     */
    async assertCanFilterTransactions(): Promise<void> {
        await this.auth.dispatch(
            {
                user: () => undefined,
                tenant: () => undefined,
                m2m_app: () => undefined
            },
            new UnauthorizedRpcError(
                `Invalid authentication type. Expected user, tenant or m2m_app, found ${this.auth.type}`
            )
        );
    }

    async visibleAddressesAmong(candidates: Address[]): Promise<AddressSet> {
        // No early return on an empty list: this dispatch is also what rejects an unauthenticated caller.
        const addresses = await this.auth.dispatch(
            {
                user: async () => {
                    const user = this.auth.currentUser();
                    const orgIds = allOrgsWithFullVisibility(user);
                    const ownAddresses = user.wallets.map((w) => w.walletAddress);
                    const orgVisibleAddresses = await this.repos.organizations.userWalletsForOrgListAmong(
                        orgIds,
                        candidates
                    );

                    return [...ownAddresses, ...orgVisibleAddresses];
                },
                tenant: () => this.repos.tenants.associatedWalletsAmong(this.auth.currentTenant().id, candidates),
                m2m_app: async () => {
                    if (!hasSystemPermission(this.auth.currentM2mApp(), 'org_rpc_access')) {
                        return [];
                    }

                    const orgIds = allOrgsWithFullVisibility(this.auth.currentM2mApp());
                    const [ownOrgAddresses, orgVisibleAddresses] = await Promise.all([
                        this.repos.m2mApps.walletAddressesForAppAmong(this.auth.currentM2mApp().id, candidates),
                        this.repos.organizations.userWalletsForOrgListAmong(orgIds, candidates)
                    ]);
                    return [...ownOrgAddresses, ...orgVisibleAddresses];
                }
            },
            new UnauthorizedRpcError(
                `Invalid authentication type. Expected user, tenant or m2m_app, found ${this.auth.type}`
            )
        );

        return new AddressSet(addresses);
    }

    async checkAddressOwnership(address: Address): Promise<boolean> {
        if (await this.hasFullSequencerAccess()) {
            return true;
        }
        const set = await this.associatedAddresses();
        return Promise.resolve(set.has(address));
    }

    async getTokenBalanceDisclosureConfig(
        tokenAddress: Address,
        holderAddress: Address
    ): Promise<DisclosureConfig | null> {
        const contract = await this.repos.contracts.findByAddress(tokenAddress).catch(() => null);
        if (!contract) return null;

        const normalized = contract.disclosedAddresses.map((t) => t.address.toLowerCase());
        if (!normalized.includes(holderAddress.toLowerCase())) return null;

        return { disclosureStartBlock: contract.disclosureStartBlock };
    }

    async getBytecodeDisclosureConfig(address: Address): Promise<DisclosureConfig | null> {
        return this.repos.contracts.getBytecodeDisclosureConfig(address);
    }

    async getTokenSupplyDisclosureConfig(address: Address): Promise<DisclosureConfig | null> {
        const contract = await this.repos.contracts.findByAddress(address).catch(() => null);
        if (!contract?.discloseErc20TotalSupply) return null;
        return { disclosureStartBlock: contract.disclosureStartBlock };
    }

    checkStorageRead(_contract: Address, _slot: Hex): Promise<boolean> {
        return Promise.resolve(false);
    }

    async ensureUserExists(): Promise<void> {
        await this.auth.dispatch(
            {
                // If user, tenant or m2m_app no-op. Otherwise, error.
                user: () => {},
                tenant: () => {},
                m2m_app: () => {}
            },
            new UnauthorizedRpcError(
                `Invalid authentication type. Expected user, tenant or m2m_app, found ${this.auth.type}`
            )
        );
    }

    hasFullSequencerAccess(): Promise<boolean> {
        return this.auth.dispatch(
            {
                user: () => {
                    return this.auth.permix().check('sequencer', 'fullAccess');
                },
                m2m_app: () => this.auth.permix().check('sequencer', 'fullAccess'),
                tenant: () => this.auth.permix().check('sequencer', 'fullAccess'),
                service: () => false,
                anonymous: () => false
            },
            new UnauthorizedRpcError(`Invalid authentication type: ${this.auth.type}`)
        );
    }

    hasFullReadAccess(): Promise<boolean> {
        return this.auth.dispatch(
            {
                user: () => this.auth.permix().check('sequencer', 'fullReadAccess'),
                m2m_app: () => this.auth.permix().check('sequencer', 'fullReadAccess'),
                tenant: () => false,
                service: () => false,
                anonymous: () => false
            },
            new UnauthorizedRpcError(`Invalid authentication type: ${this.auth.type}`)
        );
    }

    async hasRpcMethodPermission(method: string): Promise<boolean> {
        return this.auth.permix().check('rpcMethod', 'unrestrictedRead', method);
    }

    hasDeploymentPermission(): Promise<boolean> {
        return this.auth.dispatch(
            {
                user: () => this.auth.permix().check('sequencer', 'deployment'),
                m2m_app: () => this.auth.permix().check('sequencer', 'deployment'),
                tenant: () => false,
                service: () => false,
                anonymous: () => false
            },
            new UnauthorizedRpcError(`Invalid authentication type: ${this.auth.type}`)
        );
    }

    /**
     * Contract-creation authorization, returning the user the deployment is recorded against.
     * @returns `deployerUserId` on allow only; a `ruleId` naming the deciding check on deny
     */
    async authorizeDeployment(from: Address): Promise<DeploymentAuthorization> {
        return this.auth.dispatch<DeploymentAuthorization, UnauthorizedRpcError>(
            {
                user: async () => {
                    if (!(await this.checkAddressOwnership(from))) {
                        return { authorized: false, ruleId: 'deploy.address_not_owned' };
                    }
                    if (!this.auth.permix().check('sequencer', 'deployment')) {
                        return { authorized: false, ruleId: 'deploy.permission_missing' };
                    }
                    return { authorized: true, ruleId: 'deploy.allow', deployerUserId: this.auth.currentUser().id };
                },
                m2m_app: async () => {
                    const m2mApp = this.auth.currentM2mApp();
                    if (!hasSystemPermission(m2mApp, 'org_rpc_access')) {
                        return { authorized: false, ruleId: 'm2m.rpc_access_missing' };
                    }
                    if (!this.auth.permix().check('sequencer', 'deployment')) {
                        return { authorized: false, ruleId: 'deploy.permission_missing' };
                    }

                    // Resolve via the org-scoped lookup, not checkAddressOwnership: the latter
                    // short-circuits on full_sequencer_rpc_access and would skip signer ownership.
                    const user = await this.repos.m2mApps.findUserWithRolesByAddressForApp(m2mApp.id, from);
                    if (!user) {
                        return { authorized: false, ruleId: 'm2m.user_not_found' };
                    }
                    if (!sequencerAccessControl(user).deployment) {
                        return { authorized: false, ruleId: 'deploy.permission_missing' };
                    }

                    return { authorized: true, ruleId: 'deploy.allow', deployerUserId: user.id };
                },
                tenant: () => ({ authorized: false, ruleId: 'deploy.permission_missing' })
            },
            new UnauthorizedRpcError(`Invalid authentication type: ${this.auth.type}`)
        );
    }

    /**
     * Event log filtering (eth_getLogs). Unlike checkContractAccess, this uses group-level
     * roles instead of individual user roles:
     *   - user: checks the user's roles + wallets against event permissions.
     *   - tenant: uses tenant.defaultRoles + all tenant wallets (not individual user roles).
     *   - m2m_app: requires `org_rpc_access`, uses m2mApp.roles + all org wallets
     *     (not individual user roles).
     */
    async checkBatchEventRead<T extends LogData>(logData: T[]): Promise<T[]> {
        const events = logData.map((l) => ({
            contractAddress: l.address,
            topic0: l.topics[0],
            topic1: l.topics[1],
            topic2: l.topics[2],
            topic3: l.topics[3]
        }));
        // eth_getBlockReceipts filters one receipt at a time, so without this the same contracts
        // would be looked up once per receipt.
        const contractOrgs = await this.contractOrgsWithCache(events.map((e) => e.contractAddress));
        const response = await this.auth.dispatch(
            {
                user: async () => {
                    const user = this.auth.currentUser();
                    return this.eventVerifier.checkMany(
                        {
                            roleIds: user.roles.map((r) => r.id),
                            wallets: user.wallets.map((w) => w.walletAddress),
                            organizationId: user.organizationId
                        },
                        events,
                        await this.orgContractAddresses(user),
                        contractOrgs
                    );
                },
                tenant: async () => {
                    const tenant = this.auth.currentTenant();
                    return this.eventVerifier.checkMany(
                        {
                            roleIds: tenant.defaultRoles.map((r) => r.id),
                            wallets: await this.repos.tenants.allAssociatedWallets(tenant.id),
                            organizationId: null
                        },
                        events,
                        [],
                        contractOrgs
                    );
                },
                // Event reads are app-role-driven, not user-resolved: the app's own roles select permissions.
                m2m_app: async () => {
                    const m2mApp = this.auth.currentM2mApp();
                    if (!hasSystemPermission(m2mApp, 'org_rpc_access')) {
                        return events.map(() => false);
                    }

                    const linkedOrgWallets = await this.repos.m2mApps.walletAddressesByOrgForApp(m2mApp.id);
                    return this.eventVerifier.checkMany(
                        {
                            roleIds: m2mApp.roles.map((r) => r.id),
                            wallets: [...linkedOrgWallets.values()].flat(),
                            organizationId: null,
                            linkedOrgWallets
                        },
                        events,
                        await this.orgContractAddresses(m2mApp),
                        contractOrgs
                    );
                }
            },
            new UnauthorizedRpcError(
                `Invalid authentication type. Expected user, tenant or m2m_app, found ${this.auth.type}`
            )
        );

        return logData.filter((_, i) => response[i]);
    }

    async checkContractAuthorship(address: Hex): Promise<boolean> {
        // Resolve the caller's addresses first. For anonymous callers this
        // throws UnauthorizedRpcError, so the reconciliation path below
        // (which does up to N upstream eth_getTransactionReceipt calls plus a
        // possible DB write) never runs for unauthenticated traffic. Without
        // this gate, the Promise.all in checkAddressOrContractOwnership lets
        // anonymous callers amplify one HTTP request into N upstream calls.
        const addresses = await this.associatedAddresses();

        const deployment =
            (await this.repos.contractDeployments.findByAddress(address)) ??
            (await this.reconcilePendingDeployment(address));

        if (!deployment) {
            return false;
        }

        return addresses.has(deployment.deployerAddress);
    }

    /**
     * Resolves a deployment whose sync submission hit an EIP-7966 timeout
     * (deploy-utils.ts leaves the row pending in that case). Looks up the
     * receipt for each pending row's `deployTxHash`, most recent first. If
     * the tx mined and produced a contract at the queried address, marks
     * the deployment successful so subsequent authorship lookups pick it
     * up.
     *
     * Iterates across all pending rows because a timeout-plus-retry leaves
     * several rows for the same predicted address, and only one of them
     * actually mined. Continues past rows whose receipt fetch fails or
     * whose tx hasn't mined yet.
     *
     * Returns the reconciled deployment, or undefined if nothing matched.
     */
    private async reconcilePendingDeployment(address: Hex): Promise<ContractDeployment | undefined> {
        const pendings = await this.repos.contractDeployments.findAllPendingByAddress(address);
        for (const pending of pendings) {
            let receiptContractAddress: Address | null;
            try {
                receiptContractAddress = await this.targetRpc.deployReceiptContractAddress(
                    `authorship_reconcile_${pending.id}`,
                    pending.deployTxHash as Hex
                );
            } catch (err) {
                this.logger.warn(
                    { err, deploymentId: pending.id, txHash: pending.deployTxHash, address },
                    'authorship reconcile: deploy receipt fetch failed'
                );
                continue;
            }
            if (!receiptContractAddress) continue;
            if (!areHexEqual(receiptContractAddress, address)) continue;

            try {
                return await this.repos.contractDeployments.success(pending.id);
            } catch (err) {
                this.logger.warn(
                    { err, deploymentId: pending.id, txHash: pending.deployTxHash, address },
                    'authorship reconcile: success write failed; authorizing from on-chain receipt'
                );
                // Authorship is already proven by the on-chain receipt above
                return pending;
            }
        }
        return undefined;
    }

    private async orgContractAddresses(roleHolder: RoleHolder) {
        const orgIds = allOrgsWithFullVisibility(roleHolder, ['rpc_read_eth_getLogs']);
        const queries = orgIds.map((orgId) => this.repos.contracts.allContractAddressesForOrg(orgId));
        return Promise.all(queries).then((queries) => queries.flat());
    }

    async couldQueryMatchPermissions(filter: GetLogsFilter): Promise<boolean> {
        return this.auth.dispatch(
            {
                user: async () => {
                    const user = this.auth.currentUser();
                    return this.eventVerifier.couldQueryMatch(user.id, filter, await this.orgContractAddresses(user));
                },
                tenant: async () => {
                    const tenant = this.auth.currentTenant();
                    const roleIds = tenant.defaultRoles.map((r) => r.id);
                    const walletAddresses = await this.repos.tenants.allAssociatedWallets(tenant.id);
                    return this.eventVerifier.couldQueryMatchForTenant(walletAddresses, roleIds, filter);
                },
                m2m_app: async () => {
                    const m2mApp = this.auth.currentM2mApp();
                    if (!hasSystemPermission(m2mApp, 'org_rpc_access')) {
                        return false;
                    }

                    const addresses = await this.repos.m2mApps.findAllWalletAddressesForApp(m2mApp.id);
                    const roleIds = m2mApp.roles.map((r) => r.id);
                    return this.eventVerifier.couldQueryMatchForTenant(
                        addresses,
                        roleIds,
                        filter,
                        await this.orgContractAddresses(m2mApp)
                    );
                }
            },
            new UnauthorizedRpcError(`Invalid auth type: ${this.auth.type}`)
        );
    }

    async hasOrgVisibilityOver(
        toAddress: Address,
        includeUsers: boolean = false,
        extraGrantPermissions: SystemPermission[] = []
    ): Promise<boolean> {
        return this.auth.dispatch(
            {
                user: () => {
                    const user = this.auth.currentUser();
                    return this.orgScopedVisibility(user, toAddress, includeUsers, extraGrantPermissions);
                },
                m2m_app: () => {
                    const m2mApp = this.auth.currentM2mApp();
                    if (!hasSystemPermission(m2mApp, 'org_rpc_access')) {
                        return false;
                    }
                    return this.orgScopedVisibility(m2mApp, toAddress, includeUsers, extraGrantPermissions);
                },
                anonymous: () => false,
                service: () => false,
                tenant: () => false
            },
            new UnauthorizedRpcError(`Invalid auth type: ${this.auth.type}`)
        );
    }

    /**
     * Shared org-scoping check for entity visibility over an address granted via full organization visibility.
     * An entity has full organization visibility when a role owned by the org provides the right permissions.
     *
     * @param roleHolder
     * @param toAddress - Address to check visibility over
     * @param includeUsers - Whether to check if the address belongs to a fully visible organization or not. This
     * requires extra db queries.
     * @param extraGrantPermissions - Whether some other permissions aside from the basic ones (full_read_access,
     * fill_sequencer_rpc_access) should be considered as full org visibility in this case.
     */
    private async orgScopedVisibility(
        roleHolder: RoleHolder,
        toAddress: Address,
        includeUsers: boolean,
        extraGrantPermissions: SystemPermission[]
    ): Promise<boolean> {
        const contract = await this.findContractWithCache(toAddress);
        const orgId = contract?.organizationId;

        if (
            orgId &&
            hasAnySystemPermission(
                roleHolder,
                ['full_read_access', 'full_sequencer_rpc_access', ...extraGrantPermissions],
                orgId
            )
        ) {
            return true;
        }

        if (!includeUsers) {
            return false;
        }

        // This logic goes after all early returns to avoid query db when possible
        const orgIds = allOrgsWithFullVisibility(roleHolder, extraGrantPermissions);
        return this.repos.organizations.walletBelongsToOrgList(toAddress, orgIds);
    }

    private async contractOrgsWithCache(addresses: Address[]): Promise<Map<string, string | null>> {
        if (!this.eventVerifier.multiOrgEnabled) {
            return this._contractOrgs;
        }
        const missing = [...new Set(addresses.map((a) => a.toLowerCase()))].filter(
            (key) => !this._contractOrgs.has(key)
        );
        if (missing.length > 0) {
            const fetched = await this.repos.contracts.organizationIdsByAddresses(missing as Address[]);
            for (const key of missing) {
                this._contractOrgs.set(key, fetched.get(key) ?? null);
            }
        }
        return this._contractOrgs;
    }

    private async findContractWithCache(address: Address): Promise<Contract | null> {
        const key = address.toLowerCase();
        let contract = this._contracts.get(key);
        if (contract === undefined) {
            contract = await this.repos.contracts.findByAddress(address).catch((e) => {
                if (e instanceof EntityNotFound) return null;
                throw e;
            });
            this._contracts.set(key, contract);
        }
        return contract;
    }
}

function allOrgsWithFullVisibility(
    roleHolder: Pick<RoleHolder, 'roles'>,
    extraGrantPermissions: SystemPermission[] = []
) {
    const permissions: SystemPermission[] = ['full_sequencer_rpc_access', 'full_read_access', ...extraGrantPermissions];

    return roleHolder.roles
        .filter((r) => {
            return permissions.some((p) => r.systemPermissions?.includes(p));
        })
        .map((r) => r.organizationId)
        .filter((id) => id !== null);
}
