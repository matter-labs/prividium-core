import { type AuthorizationOverlay, OVERLAY_UNAVAILABLE, type OverlayMoment, OverlayRefusal } from '@repo/api-kit';
import type { Address, Hex } from 'viem';
import type { AuthorizationResult, SequencerAuthorizer } from './authorization-service';
import { type DecisionCacheStore, withDecisionCache } from './decision-cache';
import type { TransactionClassifier } from './transaction-classifier';

/**
 * Request input for the `/admit` policy check, after wire-schema validation.
 * Field names mirror the shape `zksync-os-server`'s `PolicyClient` posts
 * (lib/tx_validators/src/policy_client/mod.rs); wire-level parsing lives in
 * the route handler, this service consumes the already-typed form.
 */
export type AdmitInput = {
    protocolVersion: string;
    from: Address;
    to?: Address;
    value: bigint;
    calldata: Hex;
    gasLimit: number;
    /**
     * Caller's intent for the originating RPC verb on the chain side:
     * `eth_call` is `read`; `eth_estimateGas`, `eth_sendRawTransaction`, and
     * the sequencer's block-build path are `write`. Matched against the
     * per-method permission row's `accessType` column. `write` implies
     * `read`, so a `Write` rule covers both intents; a `Read` rule only
     * covers `Read` intents.
     */
    accessType: 'read' | 'write';
    /**
     * The transaction this call is about, where one exists. Gas estimation and the
     * block-build path omit it: they admit an operation, not a transaction.
     */
    txHash?: Hex;
    moment?: OverlayMoment;
};

type Deps<S> = {
    authorizer: SequencerAuthorizer<S>;
    transactionClassifier: TransactionClassifier;
    /** Versions accepted on the request. See `POLICY_PROTOCOL_VERSIONS` in env.ts. */
    protocolVersions: string[];
    /** Optional decision cache. When unset, every call evaluates against the DB. */
    cache?: DecisionCacheStore;
    /**
     * A private feature's narrowing stage. When set, an allow from the capability
     * gate is then put to it. Absent leaves behaviour unchanged.
     */
    overlays?: readonly AuthorizationOverlay[];
    logger?: OverlayLogger;
};

type OverlayLogger = {
    error(obj: unknown, msg?: string): void;
};

/**
 * Evaluates the Prividium admit policy for a user-submitted tx. Branches on
 * whether the tx is a method call (`to` present) or a contract creation
 * (`to` absent), dispatches to its {@link SequencerAuthorizer}, and returns
 * a structured decision.
 *
 * Does NOT map decisions to HTTP status codes — the route handler returns
 * 200 with the decision payload on all "this-is-the-answer" paths, and the
 * Fastify error handler converts any unexpected throw into a 5xx. The
 * sequencer treats non-2xx as fail-closed (by design), so internal errors
 * must surface as errors, not `allow: false`.
 */
export class AdmitService<S> {
    private authorizer: SequencerAuthorizer<S>;
    private transactionClassifier: TransactionClassifier;
    private protocolVersions: string[];
    private cache?: DecisionCacheStore;
    private overlays: readonly AuthorizationOverlay[];
    private logger?: OverlayLogger;

    constructor({ authorizer, transactionClassifier, protocolVersions, cache, overlays, logger }: Deps<S>) {
        this.authorizer = authorizer;
        this.transactionClassifier = transactionClassifier;
        this.protocolVersions = protocolVersions;
        this.cache = cache;
        this.overlays = overlays ?? [];
        this.logger = logger;
    }

    /**
     * Read-through cache wrapper around {@link evaluate}. The decision is a pure
     * function of the inputs and policy state, so a hit is safe. Only successful
     * evaluations are cached: an internal error throws out of `evaluate` before
     * `set`, so it stays fail-closed and uncached. Every request field the
     * capability gate can read is part of the key, so the key is always a superset
     * of the decision inputs: the cache stays correct even if the gate starts
     * reading a field it ignores today. `txHash` and `moment` are excluded: only the
     * overlay reads them, and it runs outside this cache.
     */
    async admit(input: AdmitInput): Promise<AuthorizationResult> {
        const capability = await withDecisionCache(
            this.cache,
            'admit',
            [
                'admit',
                input.protocolVersion,
                input.accessType,
                input.from.toLowerCase(),
                input.to?.toLowerCase() ?? '-',
                input.value.toString(),
                input.calldata.toLowerCase(),
                input.gasLimit.toString()
            ],
            () => this.evaluate(input)
        );

        if (!capability.authorized || capability.exemptFromOverlays === true || this.overlays.length === 0) {
            return capability;
        }

        // Reads move nothing, and a rule needing a decision would refuse them: that denies
        // `eth_call` and gas estimation for the very operation the caller is preparing to
        // submit, and a read would consume the decision's first admission.
        if (input.accessType === 'read') {
            return capability;
        }

        // Narrowing only: on an overlay allow the capability result is returned
        // unchanged, so `isUmbrella` -- which judge reads to prune a frame's
        // subtree -- survives. Left outside the cache above on purpose, because an
        // overlay's verdict can depend on state that changes between identical
        // calls.
        const verdict = await this.overlayVerdict(input);
        return verdict === undefined || verdict.authorized ? capability : verdict;
    }

    /** Fail-closed: a throwing overlay is a denial. An `OverlayRefusal` carries its own
     * rule id so it is not reported as an outage; this reason reaches the sequencer. */
    private async overlayVerdict(input: AdmitInput): Promise<AuthorizationResult | undefined> {
        const subject = {
            from: input.from,
            to: input.to,
            value: input.value,
            calldata: input.calldata,
            txHash: input.txHash,
            moment: input.moment
        };

        // A conjunction: the first denial wins and the rest are not consulted, so
        // several features can each narrow without any of them being able to widen.
        // Composition lives here rather than in each composition root, because the
        // fail-closed rule is the core's guarantee to make.
        for (const overlay of this.overlays) {
            let verdict: AuthorizationResult | undefined;
            try {
                verdict = await overlay.check(subject);
            } catch (error) {
                if (error instanceof OverlayRefusal) {
                    return error.verdict;
                }
                this.logger?.error({ err: error }, 'Authorization overlay failed; denying');
                return OVERLAY_UNAVAILABLE;
            }
            if (verdict !== undefined && !verdict.authorized) {
                return verdict;
            }
        }
        return undefined;
    }

    private async evaluate(input: Omit<AdmitInput, 'txHash'>): Promise<AuthorizationResult> {
        if (!this.protocolVersions.includes(input.protocolVersion)) {
            return {
                authorized: false,
                ruleId: 'protocol.version_mismatch',
                reason: `protocolVersion mismatch (got "${input.protocolVersion}", supported [${this.protocolVersions.map((v) => `"${v}"`).join(', ')}])`
            };
        }

        const subject = await this.authorizer.resolveSigner(input.from);
        if (subject === undefined) {
            return { authorized: false, ruleId: 'user.not_found' };
        }

        // Resolved by from-address, so no credential check has run: the branches below include a native
        // transfer and a deployment, neither of which reaches `checkCall`.
        const refusal = await this.authorizer.checkSigner(subject);
        if (refusal !== undefined) {
            return refusal;
        }

        if (input.to === undefined) {
            // Contract-creation tx. Mirrors Prividium's existing RPC handler:
            // requires the contract_deployment system permission + wallet ownership.
            return this.authorizer.checkDeployment(subject, input.from);
        }

        // A bare native transfer to an EOA runs no code, so there is no method to
        // gate (mirrors the RPC transfer-to-eoa path). Transfers to a contract
        // (receive/fallback runs) and empty txs fall through to the method check.
        // An EIP-7702 tx would look like a bare transfer here; decodeTx rejects it at the RPC gate.
        const classification = await this.transactionClassifier.classifyTransaction(
            input.to,
            input.calldata,
            input.value
        );
        if (classification.type === 'transfer-to-eoa') {
            return this.authorizer.checkTransfer(subject, input.to);
        }

        return this.authorizer.checkCall(
            subject,
            { contractAddress: input.to, calldata: input.calldata },
            { from: input.from, accessType: input.accessType }
        );
    }
}
