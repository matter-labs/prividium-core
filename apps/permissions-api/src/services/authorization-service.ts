import type { OverlayRuleId } from '@repo/api-kit';
import { and, eq, inArray } from 'drizzle-orm';
import { type Abi, type Address, decodeFunctionData, type Hex, isAddress, isAddressEqual, size } from 'viem';
import { z } from 'zod/v4';
import type { Repositories } from '../db';
import {
    argumentRestrictionsTable,
    contractFunctionPermissionRolesTable,
    contractFunctionPermissionsTable,
    contractsTable,
    contractTemplateArgumentRestrictionsTable,
    contractTemplatePermissionRolesTable,
    contractTemplatePermissionsTable,
    contractTemplatesTable,
    type MethodAccessType
} from '../db/schema';
import type { User, UserWithRoles } from '../repositories/users-repository';
import { resolveAbiItem } from '../utils/abi';
import { EntityNotFound } from '../utils/error-types';
import { extractSelector } from '../utils/extract-selector';
import { fetchChunked } from '../utils/fetch-chunked';
import { belongsToDeletedOrganization } from '../utils/organization-membership';
import { fetchArgMap, fetchRoleSet } from '../utils/permission-reads';
import type { MethodSelector } from '../utils/schemas/hex-schema';
import { userHasWallet } from '../utils/user-wallets';

export const methodAuthorizationSchema = z.object({
    authorized: z.boolean()
});

/**
 * Boundary callers (admit, RPC authorizer, tenant, wallet) pass the RPC verb
 * intent (`'read'` or `'write'`). The row's `accessType` column is then
 * matched with `write ⊇ read`. Judge's inner-frame check passes
 * `'unenforced'`: the row's classification governs on its own mid-trace.
 * Role and argument gates always fire.
 */
export type AccessTypeCheck = MethodAccessType | 'unenforced';

/**
 * Stable identifier for the decision site that produced an authorization
 * result. The sequencer maps this back when surfacing policy rejections,
 * so adding or renaming a member is a wire change.
 */
export type RuleId =
    | 'tenant.not_associated'
    | 'user.not_found'
    | 'wallet.not_owned_by_user'
    | 'permission.missing'
    | 'permission.access_type_mismatch'
    | 'permission.org_mismatch'
    | 'user.organization_deleted'
    | 'm2m.rpc_access_missing'
    | 'm2m.user_not_found'
    | 'rule.public.allow'
    | 'rule.check_role.allow'
    | 'rule.check_role.deny'
    | 'rule.restrict_argument.allow'
    | 'rule.restrict_argument.deny'
    | 'rule.restrict_argument.decode_failed'
    | 'rule.or.allow_role'
    | 'rule.or.allow_args'
    | 'rule.or.deny_both'
    | 'rule.and.allow'
    | 'rule.and.deny_role'
    | 'rule.and.deny_args'
    | 'rule.unknown'
    | 'transfer.native.allow'
    | 'deploy.allow'
    | 'deploy.address_not_owned'
    | 'deploy.permission_missing'
    | 'protocol.version_mismatch'
    | 'judge.no_frames'
    | 'judge.allow'
    // Contributed by a private feature's authorization overlay. The core does not
    // enumerate these: it forwards the id the overlay reported so the sequencer can
    // map a rejection back to the decision site that made it.
    | OverlayRuleId;

/**
 * Service-internal authorization result. Wider than `methodAuthorizationSchema`:
 * carries a stable `ruleId` identifying which decision site decided, plus an
 * optional human-readable `reason`. Consumed by the `/admit` policy route so
 * the sequencer can report rejections by the same rule id the Prividium API
 * would have used. External routes that expose only `authorized` (e.g.
 * `/wallet-actions/verify-allowance`) narrow this back down at the response
 * boundary.
 */
export type AuthorizationResult = {
    authorized: boolean;
    ruleId?: RuleId;
    reason?: string;
    /**
     * Set on allow when the matched method permission has `is_umbrella` enabled.
     * Judge reads this to skip recursion into the frame's subtree. Only
     * meaningful when `authorized === true`. Ignored on deny.
     */
    isUmbrella?: boolean;
};

type Deps = {
    repos: Repositories;
    multiOrgEnabled?: boolean;
};

/**
 * Minimal shape of a function-permission row that the rule-type dispatch in
 * {@link AuthorizationService.decidePermission} reads. Both contract and
 * template permission rows satisfy it.
 */
type DecidablePermission = {
    id: number;
    accessType: MethodAccessType;
    ruleType: string;
    isUmbrella: boolean;
    organizationOnly: boolean;
};

/**
 * The contract row a decision reads. `undefined` means the address is not registered at all,
 * which is a different thing from a registered zone-level contract (`organizationId: null`).
 */
type RegisteredContract = { organizationId: string | null };

/**
 * Outcome of evaluating one call in {@link AuthorizationService.checkUserAuthorizationForCalls}.
 * A call whose evaluation throws (for example an unparsable selector) is
 * captured as `error` instead of rejecting the whole batch, so the caller can
 * re-throw it at the matching point and stay fail-closed.
 */
export type FrameEvaluation = { kind: 'result'; result: AuthorizationResult } | { kind: 'error'; error: unknown };

/**
 * Where the decision request came from, for an authorizer that audits it.
 * `requestId` is the per-HTTP-request id, so a JSON-RPC batch shares one value.
 * Absent on the policy (`/admit`, `/judge`) and wallet-action paths.
 */
export type AuthorizationRequestContext = {
    rpcMethod?: string;
    requestId?: string;
};

/** One method authorization to decide: the acting wallet, the user behind it, and the call. */
export type MethodAuthorizationRequest = AuthorizationRequestContext & {
    fromAddress: Address | undefined;
    user: User;
    contractAddress: Address;
    calldata: Hex;
    accessTypeCheck: AccessTypeCheck;
};

/**
 * The decision surface the RPC path calls. Typed as an interface so a host can
 * serve `rpcRoutes` against its own engine instead of {@link AuthorizationService}.
 */
export interface MethodAuthorizer {
    checkMethodAuthorizationForUser(request: MethodAuthorizationRequest): Promise<AuthorizationResult>;

    checkForTenant(
        tenantId: string,
        fromAddress: Hex,
        contractAddress: Hex,
        calldata: Hex,
        accessType: MethodAccessType,
        context?: AuthorizationRequestContext
    ): Promise<AuthorizationResult>;
}

// Composite keys for matching prefetched permission rows to frames in memory.
// Addresses and selectors are compared case-insensitively.
const contractPermissionKey = (address: string, selector: string) =>
    `${address.toLowerCase()}|${selector.toLowerCase()}`;
const templatePermissionKey = (templateId: number, selector: string) => `${templateId}|${selector.toLowerCase()}`;

/** Outcome of an argument-restriction check. `decode_failed` maps to its own rule id. */
type ArgumentCheckOutcome = 'allowed' | 'denied' | 'decode_failed';

/**
 * Argument-restriction check shared by the direct and batched paths: every
 * restricted argument must equal the acting wallet address (the tx signer /
 * `from`), not merely any wallet the user owns. Calldata that cannot be decoded
 * against the ABI returns `decode_failed`, so the caller denies with a distinct
 * rule id instead of throwing.
 */
function checkArgumentRestrictions(
    restrictions: { argumentIndex: number }[],
    actingAddress: Address,
    calldata: Hex,
    abi: Abi
): ArgumentCheckOutcome {
    let args: readonly unknown[] | undefined;
    try {
        ({ args } = decodeFunctionData({ abi, data: calldata }));
    } catch {
        return 'decode_failed';
    }

    if (args === undefined) {
        return restrictions.length === 0 ? 'allowed' : 'denied';
    }

    const allMatch = restrictions.every(({ argumentIndex }) => {
        const value = args[argumentIndex];
        // Format-only guard (no EIP-55 requirement, matching on-chain 20-byte equality); non-addresses deny.
        return typeof value === 'string' && isAddress(value, { strict: false }) && isAddressEqual(actingAddress, value);
    });
    return allMatch ? 'allowed' : 'denied';
}

export class AuthorizationService implements MethodAuthorizer {
    private repos: Repositories;
    private multiOrgEnabled: boolean;

    constructor({ repos, multiOrgEnabled = false }: Deps) {
        this.repos = repos;
        this.multiOrgEnabled = multiOrgEnabled;
    }

    async checkForTenant(
        tenantId: string,
        fromAddress: Hex,
        contractAddress: Hex,
        calldata: Hex,
        accessType: MethodAccessType,
        context: AuthorizationRequestContext = {}
    ): Promise<AuthorizationResult> {
        const belongs = await this.repos.tenants.isAddressAssociatedToTenant(tenantId, fromAddress);
        if (!belongs) {
            return { authorized: false, ruleId: 'tenant.not_associated' };
        }

        const user = await this.repos.users.findByAddress(fromAddress);

        if (!user) {
            return { authorized: false, ruleId: 'user.not_found' };
        }

        return this.checkMethodAuthorizationForUser({
            ...context,
            fromAddress,
            user,
            contractAddress,
            calldata,
            accessTypeCheck: accessType
        });
    }

    async checkMethodAuthorizationForUser({
        fromAddress,
        user,
        contractAddress,
        calldata,
        accessTypeCheck
    }: MethodAuthorizationRequest): Promise<AuthorizationResult> {
        const selector = size(calldata) === 0 ? '0x' : extractSelector(calldata);

        // Step 1: Verify that the wallet address is assigned to the given user
        if (!fromAddress || !userHasWallet(user, fromAddress)) {
            return { authorized: false, ruleId: 'wallet.not_owned_by_user' };
        }

        // Step 2: Get the contract to check if it has a template and which organization owns it
        const contract = await this.repos.db.query.contractsTable.findFirst({
            where: (f, { eq }) => eq(f.contractAddress, contractAddress),
            columns: { templateId: true, organizationId: true }
        });

        // Step 3: Query both contract permission and template permission
        const [contractPermission] = await this.repos.db
            .select()
            .from(contractFunctionPermissionsTable)
            .where(
                and(
                    eq(contractFunctionPermissionsTable.contractAddress, contractAddress),
                    eq(contractFunctionPermissionsTable.methodSelector, selector)
                )
            );

        let templatePermission = null;
        if (contract?.templateId) {
            [templatePermission] = await this.repos.db
                .select()
                .from(contractTemplatePermissionsTable)
                .where(
                    and(
                        eq(contractTemplatePermissionsTable.templateId, contract.templateId),
                        eq(contractTemplatePermissionsTable.methodSelector, selector)
                    )
                );
        }

        // Step 4: Determine which permission to use (contract overrides template)
        const permission = contractPermission ?? templatePermission;

        // Apply the rule-type decision, resolving roles and argument
        // restrictions against the DB on demand (only the rule types that need
        // them trigger a read).
        return this.decidePermission({
            user,
            permission: permission ?? undefined,
            isContractPermission: !!contractPermission,
            contract,
            accessTypeCheck,
            roleOk: (perm, isContractPermission) => this.checkRoleAuthorization(user, perm.id, isContractPermission),
            argsOk: async (perm, isContractPermission) => {
                const abi = await this.abiFor(contractAddress, selector);
                return this.restrictArgument(perm.id, fromAddress, isContractPermission, calldata, abi);
            }
        });
    }

    /**
     * Decides a single method authorization from an already-resolved permission
     * row: applies the access-type check, organization scoping, and the
     * rule-type dispatch (public / checkRole / restrictArgument / their
     * combinations), returning the {@link AuthorizationResult}. The role and
     * argument-restriction checks are deferred to the caller-supplied `roleOk` /
     * `argsOk` resolvers, backed by a DB read or a prefetched lookup depending
     * on the caller, and are invoked only for the rule types that need them.
     */
    private async decidePermission(params: {
        user: User;
        permission: DecidablePermission | undefined;
        isContractPermission: boolean;
        contract: RegisteredContract | undefined;
        accessTypeCheck: AccessTypeCheck;
        umbrellaCovered?: boolean;
        roleOk: (permission: DecidablePermission, isContractPermission: boolean) => Promise<boolean>;
        argsOk: (permission: DecidablePermission, isContractPermission: boolean) => Promise<ArgumentCheckOutcome>;
    }): Promise<AuthorizationResult> {
        const { user, permission, isContractPermission, contract, accessTypeCheck, umbrellaCovered, roleOk, argsOk } =
            params;

        // A dead org's id still matches its contracts', so the org check below would allow.
        if (belongsToDeletedOrganization(user)) {
            return { authorized: false, ruleId: 'user.organization_deleted' };
        }

        // Judge routes frames beneath an umbrella row here rather than skipping them, so the
        // permission gate is waived but organization isolation is not. Keyed to this service's
        // own flag so a divergence from judge's copy fails closed onto the normal path.
        if (umbrellaCovered && this.multiOrgEnabled) {
            return this.decideUnderUmbrella({ user, contract, permission, isContractPermission, argsOk });
        }

        // Step 5: If no permission exists at all, return unauthorized
        if (!permission) {
            return { authorized: false, ruleId: 'permission.missing' };
        }

        // Step 6: Verify if permission is the same as the access type requested
        // Note that in this case, write implies read
        if (accessTypeCheck !== 'unenforced') {
            const validAccessType =
                permission.accessType === accessTypeCheck ||
                (permission.accessType === 'write' && accessTypeCheck === 'read');
            if (!validAccessType) {
                return { authorized: false, ruleId: 'permission.access_type_mismatch' };
            }
        }

        // Step 7: Organization scoping. Only enforced while the MULTI_ORG_ENABLED feature flag is
        // on. When the target contract belongs to an organization and the matched permission is
        // org-only (the column default), only users in that same organization may call it: users
        // from another organization and zone users (no organization) are both denied. Permissions
        // with `organizationOnly: false` and zone-level contracts (no owner org) stay unscoped.
        if (this.multiOrgEnabled && contract?.organizationId && permission.organizationOnly) {
            if (user.organizationId !== contract.organizationId) {
                return { authorized: false, ruleId: 'permission.org_mismatch' };
            }
        }

        // Step 8: Route to appropriate authorization method based on rule type.
        // `isUmbrella` is attached only on allow and only when the row has the
        // toggle set. Judge reads it to skip child-frame recursion.
        const allow = (ruleId: RuleId): AuthorizationResult =>
            permission.isUmbrella ? { authorized: true, ruleId, isUmbrella: true } : { authorized: true, ruleId };
        const restrict = (ruleId: RuleId): AuthorizationResult => ({ authorized: false, ruleId });
        switch (permission.ruleType) {
            case 'public':
                return allow('rule.public.allow');
            case 'checkRole': {
                const roleAllowed = await roleOk(permission, isContractPermission);
                return roleAllowed ? allow('rule.check_role.allow') : restrict('rule.check_role.deny');
            }
            case 'restrictArgument': {
                const args = await argsOk(permission, isContractPermission);
                if (args === 'allowed') {
                    return allow('rule.restrict_argument.allow');
                }
                return restrict(
                    args === 'decode_failed' ? 'rule.restrict_argument.decode_failed' : 'rule.restrict_argument.deny'
                );
            }
            case 'checkRoleOrRestrictArgument': {
                const [roleAllowed, args] = await Promise.all([
                    roleOk(permission, isContractPermission),
                    argsOk(permission, isContractPermission)
                ]);
                if (roleAllowed) {
                    return allow('rule.or.allow_role');
                }
                if (args === 'allowed') {
                    return allow('rule.or.allow_args');
                }
                return restrict(
                    args === 'decode_failed' ? 'rule.restrict_argument.decode_failed' : 'rule.or.deny_both'
                );
            }
            case 'checkRoleAndRestrictArgument': {
                const [roleAllowed, args] = await Promise.all([
                    roleOk(permission, isContractPermission),
                    argsOk(permission, isContractPermission)
                ]);
                if (!roleAllowed) {
                    return restrict('rule.and.deny_role');
                }
                if (args === 'allowed') {
                    return allow('rule.and.allow');
                }
                return restrict(
                    args === 'decode_failed' ? 'rule.restrict_argument.decode_failed' : 'rule.and.deny_args'
                );
            }
            default:
                return restrict('rule.unknown');
        }
    }

    /**
     * Decides a frame beneath an umbrella permission. The umbrella waives the permission and
     * role gates, not organization isolation: the callee must be registered and either
     * zone-level or the signer's own organization, and argument restrictions still apply.
     */
    private async decideUnderUmbrella(params: {
        user: User;
        contract: RegisteredContract | undefined;
        permission: DecidablePermission | undefined;
        isContractPermission: boolean;
        argsOk: (permission: DecidablePermission, isContractPermission: boolean) => Promise<ArgumentCheckOutcome>;
    }): Promise<AuthorizationResult> {
        const { user, contract, permission, isContractPermission, argsOk } = params;

        if (contract === undefined) {
            return { authorized: false, ruleId: 'permission.missing' };
        }

        // Unconditional, ignoring the row's organizationOnly: with the role gate waived below,
        // a shared row would hand a peer organization the method, and an umbrella cannot consent
        // on another organization's behalf. The method stays reachable by direct call.
        if (contract.organizationId !== null && contract.organizationId !== user.organizationId) {
            return { authorized: false, ruleId: 'permission.org_mismatch' };
        }
        if (permission === undefined) {
            return { authorized: true, ruleId: 'judge.allow' };
        }

        switch (permission.ruleType) {
            case 'public':
            case 'checkRole':
                return { authorized: true, ruleId: 'judge.allow' };
            case 'restrictArgument':
            case 'checkRoleOrRestrictArgument':
            case 'checkRoleAndRestrictArgument': {
                // The role side is waived either way: an OR rule has to hold on its argument
                // branch alone, and an AND rule degrades to its argument branch. A role holder
                // can still reach the method by calling it directly.
                const args = await argsOk(permission, isContractPermission);
                if (args === 'allowed') {
                    return { authorized: true, ruleId: 'judge.allow' };
                }
                return {
                    authorized: false,
                    ruleId:
                        args === 'decode_failed'
                            ? 'rule.restrict_argument.decode_failed'
                            : 'rule.restrict_argument.deny'
                };
            }
            default:
                return { authorized: false, ruleId: 'rule.unknown' };
        }
    }

    /**
     * Batched authorization for many calls at once (the judge path). Decides every
     * call against the same per-method rules as {@link checkMethodAuthorizationForUser},
     * but collapses the per-call DB reads into a handful of set-based queries, so
     * judge cost scales with call-tree depth rather than call count. Results align
     * to `calls` by index.
     *
     * Per-call evaluation throws (undecodable args, unknown selector) are captured
     * per item rather than propagated, so judge can re-throw them in pre-order
     * instead of failing the whole batch.
     */
    async checkUserAuthorizationForCalls(params: {
        fromAddress: Address | undefined;
        user: User;
        calls: { contractAddress: Address; calldata: Hex; umbrellaCovered?: boolean }[];
        accessTypeCheck: AccessTypeCheck;
    }): Promise<FrameEvaluation[]> {
        const { fromAddress, user, calls, accessTypeCheck } = params;
        if (calls.length === 0) return [];

        if (!fromAddress || !userHasWallet(user, fromAddress)) {
            return calls.map(() => ({
                kind: 'result',
                result: { authorized: false, ruleId: 'wallet.not_owned_by_user' }
            }));
        }

        // Capture selector-extraction throws per call (see the pre-order note
        // above) instead of aborting the whole batch.
        const selectorResults = calls.map((it) => {
            try {
                return {
                    ok: true as const,
                    selector: size(it.calldata) === 0 ? ('0x' as Hex) : extractSelector(it.calldata)
                };
            } catch (error) {
                return { ok: false as const, error };
            }
        });

        const ctx = await this.fetchCallContext(calls.map((c) => c.contractAddress));

        // Resolve the matched permission per call (contract overrides template).
        // A call whose selector failed to parse matches nothing and is surfaced
        // as an error below.
        const matched = calls.map((it, i) => {
            const sel = selectorResults[i]!;
            if (!sel.ok) {
                return { permission: undefined, isContractPermission: false };
            }
            const contractPerm = ctx.contractPermByKey.get(contractPermissionKey(it.contractAddress, sel.selector));
            if (contractPerm) {
                return { permission: contractPerm as DecidablePermission, isContractPermission: true };
            }
            const contract = ctx.contractByAddr.get(it.contractAddress.toLowerCase());
            if (contract?.templateId != null) {
                const tplPerm = ctx.templatePermByKey.get(templatePermissionKey(contract.templateId, sel.selector));
                if (tplPerm) {
                    return { permission: tplPerm as DecidablePermission, isContractPermission: false };
                }
            }
            return { permission: undefined, isContractPermission: false };
        });

        const rules = await this.fetchCallRuleData(matched, user);

        // Decide each call in memory against the prefetched rows.
        return Promise.all(
            calls.map(async (it, i): Promise<FrameEvaluation> => {
                const sel = selectorResults[i]!;
                if (!sel.ok) {
                    return { kind: 'error', error: sel.error };
                }
                const selector = sel.selector;
                const m = matched[i]!;
                const contract = ctx.contractByAddr.get(it.contractAddress.toLowerCase());
                try {
                    const result = await this.decidePermission({
                        user,
                        permission: m.permission,
                        isContractPermission: m.isContractPermission,
                        contract,
                        accessTypeCheck,
                        umbrellaCovered: it.umbrellaCovered,
                        roleOk: (perm, isContractPermission) =>
                            Promise.resolve(
                                (isContractPermission ? rules.contractRoleSet : rules.templateRoleSet).has(perm.id)
                            ),
                        argsOk: async (perm, isContractPermission) => {
                            const restrictions =
                                (isContractPermission ? rules.contractArgMap : rules.templateArgMap).get(perm.id) ?? [];
                            const abi = await resolveAbiItem(
                                contract?.abi,
                                () =>
                                    contract?.templateId != null
                                        ? ctx.templateAbiById.get(contract.templateId)
                                        : undefined,
                                selector
                            );
                            return checkArgumentRestrictions(restrictions, fromAddress, it.calldata, abi);
                        }
                    });
                    return { kind: 'result', result };
                } catch (error) {
                    return { kind: 'error', error };
                }
            })
        );
    }

    /**
     * Prefetches the per-call context for {@link checkUserAuthorizationForCalls}:
     * the contract row, template ABI, and contract/template permission rows for
     * every distinct call address, via set-based `IN (...)` queries (chunked
     * under the Postgres bound-parameter limit) and keyed for in-memory matching.
     */
    private async fetchCallContext(addresses: Address[]) {
        // Many calls in a multicall hit the same target, so collapse repeats
        // before querying: `IN (...)` is set membership and the results are
        // keyed into maps anyway, so duplicates only inflate the bound-parameter
        // list and chunk count.
        const uniqueAddresses = [...new Set(addresses)];

        const contractRows = await fetchChunked(uniqueAddresses, (chunk) =>
            this.repos.db
                .select({
                    contractAddress: contractsTable.contractAddress,
                    templateId: contractsTable.templateId,
                    organizationId: contractsTable.organizationId,
                    abi: contractsTable.abi
                })
                .from(contractsTable)
                .where(inArray(contractsTable.contractAddress, chunk))
        );
        const contractByAddr = new Map(contractRows.map((c) => [c.contractAddress.toLowerCase(), c]));

        const templateIds = [
            ...new Set(contractRows.map((c) => c.templateId).filter((id): id is number => id !== null))
        ];
        const templateRows = await fetchChunked(templateIds, (chunk) =>
            this.repos.db
                .select({ id: contractTemplatesTable.id, abi: contractTemplatesTable.abi })
                .from(contractTemplatesTable)
                .where(inArray(contractTemplatesTable.id, chunk))
        );
        const templateAbiById = new Map(templateRows.map((t) => [t.id, t.abi]));

        const contractPermRows = await fetchChunked(uniqueAddresses, (chunk) =>
            this.repos.db
                .select()
                .from(contractFunctionPermissionsTable)
                .where(inArray(contractFunctionPermissionsTable.contractAddress, chunk))
        );
        const contractPermByKey = new Map(
            contractPermRows.map((p) => [contractPermissionKey(p.contractAddress, p.methodSelector), p])
        );

        const templatePermRows = await fetchChunked(templateIds, (chunk) =>
            this.repos.db
                .select()
                .from(contractTemplatePermissionsTable)
                .where(inArray(contractTemplatePermissionsTable.templateId, chunk))
        );
        const templatePermByKey = new Map(
            templatePermRows.map((p) => [templatePermissionKey(p.templateId, p.methodSelector), p])
        );

        return { contractByAddr, templateAbiById, contractPermByKey, templatePermByKey };
    }

    /**
     * Batches the role and argument-restriction reads for the matched
     * permissions, bucketed by rule type and contract-vs-template. Returns the
     * role sets (permission ids satisfied by one of the signer's roles) and the
     * argument-restriction maps (permission id to restricted argument indices).
     */
    private async fetchCallRuleData(
        matched: { permission: DecidablePermission | undefined; isContractPermission: boolean }[],
        user: User
    ) {
        const needsRole = (rt: string) =>
            rt === 'checkRole' || rt === 'checkRoleOrRestrictArgument' || rt === 'checkRoleAndRestrictArgument';
        const needsArgs = (rt: string) =>
            rt === 'restrictArgument' || rt === 'checkRoleOrRestrictArgument' || rt === 'checkRoleAndRestrictArgument';

        const contractRolePermIds: number[] = [];
        const templateRolePermIds: number[] = [];
        const contractArgPermIds: number[] = [];
        const templateArgPermIds: number[] = [];
        for (const m of matched) {
            if (!m.permission) continue;
            if (needsRole(m.permission.ruleType)) {
                (m.isContractPermission ? contractRolePermIds : templateRolePermIds).push(m.permission.id);
            }
            if (needsArgs(m.permission.ruleType)) {
                (m.isContractPermission ? contractArgPermIds : templateArgPermIds).push(m.permission.id);
            }
        }

        const userRoleIds = user.roles.map((r) => r.id);
        const db = this.repos.db;
        const [contractRoleSet, templateRoleSet, contractArgMap, templateArgMap] = await Promise.all([
            fetchRoleSet(db, contractFunctionPermissionRolesTable, contractRolePermIds, userRoleIds),
            fetchRoleSet(db, contractTemplatePermissionRolesTable, templateRolePermIds, userRoleIds),
            fetchArgMap(db, argumentRestrictionsTable, contractArgPermIds),
            fetchArgMap(db, contractTemplateArgumentRestrictionsTable, templateArgPermIds)
        ]);
        return { contractRoleSet, templateRoleSet, contractArgMap, templateArgMap };
    }

    /**
     * Checks whether the given user may deploy contracts.
     *
     * Mirrors the RPC-path check (`RpcAuthorizer.hasDeploymentPermission` +
     * `checkAddressOwnership`) but takes the signer's user directly instead of
     * reading from a request-scoped auth context. Used by the `/admit` policy
     * route when the tx is a contract creation (`to` absent on the wire).
     */
    checkDeploymentAuthorization({
        from,
        user
    }: {
        from: Address | undefined;
        user: UserWithRoles;
    }): AuthorizationResult {
        if (!from || !userHasWallet(user, from)) {
            return { authorized: false, ruleId: 'deploy.address_not_owned' };
        }
        // Deployment has no contract to scope against, so it never reaches decidePermission's gate.
        if (belongsToDeletedOrganization(user)) {
            return { authorized: false, ruleId: 'user.organization_deleted' };
        }
        const hasPermission = user.roles.some((r) => r.systemPermissions?.includes('contract_deployment'));
        if (!hasPermission) {
            return { authorized: false, ruleId: 'deploy.permission_missing' };
        }
        return { authorized: true, ruleId: 'deploy.allow' };
    }

    /**
     * Checks authorization for role-based permissions
     */
    private async checkRoleAuthorization(
        user: User,
        permissionId: number,
        isContractPermission: boolean
    ): Promise<boolean> {
        if (isContractPermission) {
            const permissionRoles = await this.repos.db
                .select()
                .from(contractFunctionPermissionRolesTable)
                .where(
                    and(
                        eq(contractFunctionPermissionRolesTable.permissionId, permissionId),
                        inArray(
                            contractFunctionPermissionRolesTable.roleId,
                            user.roles.map((r) => r.id)
                        )
                    )
                );
            return permissionRoles.length !== 0;
        } else {
            // Template permission
            const permissionRoles = await this.repos.db
                .select()
                .from(contractTemplatePermissionRolesTable)
                .where(
                    and(
                        eq(contractTemplatePermissionRolesTable.permissionId, permissionId),
                        inArray(
                            contractTemplatePermissionRolesTable.roleId,
                            user.roles.map((r) => r.id)
                        )
                    )
                );
            return permissionRoles.length !== 0;
        }
    }

    async restrictArgument(
        permissionId: number,
        actingAddress: Address,
        isContractPermission: boolean,
        calldata: Hex,
        abi: Abi
    ): Promise<ArgumentCheckOutcome> {
        const restrictions = isContractPermission
            ? await this.repos.db.query.argumentRestrictionsTable.findMany({
                  where: (f, { eq }) => eq(f.permissionId, permissionId),
                  columns: { argumentIndex: true }
              })
            : await this.repos.db.query.contractTemplateArgumentRestrictionsTable.findMany({
                  where: (f, { eq }) => eq(f.permissionId, permissionId),
                  columns: { argumentIndex: true }
              });

        return checkArgumentRestrictions(restrictions, actingAddress, calldata, abi);
    }

    private async abiFor(contractAddress: Address, selector: MethodSelector): Promise<Abi> {
        const contract = await this.repos.db.query.contractsTable.findFirst({
            where: (f, { eq }) => eq(f.contractAddress, contractAddress),
            columns: { abi: true, templateId: true }
        });

        if (contract === undefined) {
            throw new EntityNotFound('Contract', { address: contractAddress });
        }

        // Fetch the template ABI lazily, only when the selector isn't in the
        // contract ABI itself.
        return resolveAbiItem(
            contract.abi,
            async () => {
                const { templateId } = contract;
                if (templateId === null) return undefined;
                const template = await this.repos.db.query.contractTemplatesTable.findFirst({
                    where: (f, { eq }) => eq(f.id, templateId),
                    columns: { abi: true }
                });
                return template?.abi;
            },
            selector
        );
    }
}
