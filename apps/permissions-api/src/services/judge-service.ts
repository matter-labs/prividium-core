import { type AuthorizationOverlay, OVERLAY_UNAVAILABLE, OverlayRefusal } from '@repo/api-kit';
import { type Address, type Hex, size } from 'viem';
import type { Repositories } from '../db';
import type { UserWithRoles } from '../repositories/users-repository';
import type { PinoLogger } from '../utils/logger';
import type { AuthorizationResult, AuthorizationService, FrameEvaluation } from './authorization-service';
import { type DecisionCacheStore, withDecisionCache } from './decision-cache';
import type { TransactionClassifier } from './transaction-classifier';

/**
 * Per-frame runtime trace capture. `children` holds nested frames.
 * `deploys` records CREATE/CREATE2 addresses on the parent frame, not on
 * the deploy frame itself: the deploy frame appears as a child with
 * `callee` set to the deployed address and `calldata` set to constructor
 * init code.
 *
 * `callKind` lets the policy treat delegatecall hops as part of the
 * parent's logical call (proxy/impl pattern), and tell staticcall reads
 * apart from state-mutating calls.
 */
export type CallKind = 'call' | 'delegateCall' | 'staticCall' | 'constructor';

export type TraceFrame = {
    caller: Address;
    callee: Address;
    value: string; // U256 hex
    calldata: Hex;
    deploys: Address[];
    callKind: CallKind;
    children: TraceFrame[];
};

export type JudgeTrace = {
    frame: TraceFrame | null;
};

export type JudgeInput = {
    protocolVersion: string;
    trace: JudgeTrace;
    /**
     * Originating RPC verb intent (`eth_call`: `'read'`, otherwise `'write'`).
     * Admit enforces this against the root row. Judge accepts it for protocol
     * compatibility but does not check it against inner-frame rows. The row's
     * classification governs mid-trace.
     */
    accessType: 'read' | 'write';
};

/** A frame plus whether an umbrella row above it waived the permission gate for it. */
type CoveredFrame = { frame: TraceFrame; covered: boolean };

type Deps = {
    repos: Repositories;
    authorizationService: AuthorizationService;
    transactionClassifier: TransactionClassifier;
    logger: PinoLogger;
    /** Versions accepted on the request. See `POLICY_PROTOCOL_VERSIONS` in env.ts. */
    protocolVersions: string[];
    /** Optional decision cache. When unset, every call evaluates against the DB. */
    cache?: DecisionCacheStore;
    /** Selects the umbrella semantics. See the note on umbrella in the class doc. */
    multiOrgEnabled?: boolean;
    overlays?: readonly AuthorizationOverlay[];
};

/**
 * Canonical serialization of a trace frame for cache keys. Includes every field
 * of the frame (callKind, caller, callee, value, calldata, deploys, and
 * children, recursively) so the key is always a superset of the decision
 * inputs. Keying on the full frame keeps the cache correct even if the policy
 * starts reading a field it ignores today: a different input always yields a
 * different key, never a stale hit. Hex fields are lowercased so wire-casing
 * variations share a key.
 */
function serializeFrame(frame: TraceFrame | null): unknown {
    if (frame === null) return null;
    return [
        frame.callKind,
        frame.caller.toLowerCase(),
        frame.callee.toLowerCase(),
        frame.value.toLowerCase(),
        frame.calldata.toLowerCase(),
        frame.deploys.map((d) => d.toLowerCase()),
        frame.children.map(serializeFrame)
    ];
}

/**
 * Evaluates the Prividium judge policy against a post-execution trace.
 *
 * **Subject is always the original tx signer** (= outermost frame's
 * caller). For internal calls inside a multicall, the role and wallet
 * sets evaluated are the top-level signer's, not the calling contract's.
 * This is what makes "Alice can reach `Token.transfer` through any path,
 * but not `Token.setOwner`" expressible at judge time.
 *
 * Rule set: internal method calls keyed by `(callee, selector)`. The same
 * per-method permission row admit consults for the top-level tx governs each
 * inner frame. Same five-ruleType dispatch as admit.
 *
 * Constructor frames (CREATE/CREATE2) are skipped. Their calldata is init
 * code with no selector to look up. `contract_deployment` is NOT rechecked
 * here: admit enforces it for direct deploy txs (`to` absent). Constructor
 * frames judge sees are factory-mediated (the signer called a factory whose
 * method was already permitted by admit), so requiring `contract_deployment`
 * on top of the factory method permission would break standard factory
 * patterns.
 *
 * delegateCall frames use `caller` (not `callee`) for the permission lookup.
 * Transparent proxies forward calldata unmodified, so `(caller, selector)`
 * resolves to the proxy's permission row without requiring operators to mirror
 * rules onto the impl address. Self-delegatecall frames (OZ Multicall,
 * `caller == callee`) resolve identically either way and are fully checked.
 *
 * The root frame was already evaluated by admit. Judge applies the method
 * check recursively to all child frames in the call tree.
 *
 * A matched permission row with `umbrella` enabled means the row "covers"
 * everything beneath that frame. What coverage grants depends on
 * MULTI_ORG_ENABLED:
 *
 * - Off: judge skips recursion into the frame's children entirely.
 * - On: judge keeps walking and evaluates each covered frame under the relaxed
 *   rule in `AuthorizationService.decideUnderUmbrella` - the permission gate is
 *   waived, but the callee must still be registered and either zone-level or
 *   the signer's own organization, and argument restrictions still apply. An
 *   umbrella row cannot consent on another organization's behalf, so collapsing
 *   the subtree would let one organization reach another's contracts through any
 *   contract that forwards calls.
 *
 * Either way the umbrella frame itself is evaluated normally, sibling frames at
 * the same depth are unaffected, and coverage is inherited all the way down.
 * Umbrella only applies on allow. Denies propagate as usual and short-circuit
 * the whole trace.
 *
 * The root frame is a special case: admit already approved it, so judge
 * would otherwise never inspect its permission. To make umbrella on an
 * entry-point method work (the common case, e.g. `cToken.mint(uint)` with
 * all-immutable inner targets), judge re-fetches the root permission just
 * to read its `umbrella` flag. If set, the whole trace is covered.
 *
 * Mirrors `AdmitService`: protocol-version mismatch is surfaced as a 200-OK
 * deny with `ruleId=protocol.version_mismatch`, not a 5xx. The sequencer
 * treats non-2xx as fail-closed, so HTTP errors are reserved for genuine
 * internal failures.
 */
export class JudgeService {
    private repos: Repositories;
    private authorizationService: AuthorizationService;
    private transactionClassifier: TransactionClassifier;
    private logger: PinoLogger;
    private protocolVersions: string[];
    private cache?: DecisionCacheStore;
    private multiOrgEnabled: boolean;
    private overlays: readonly AuthorizationOverlay[];

    constructor({
        repos,
        authorizationService,
        transactionClassifier,
        logger,
        protocolVersions,
        cache,
        multiOrgEnabled = false,
        overlays
    }: Deps) {
        this.repos = repos;
        this.authorizationService = authorizationService;
        this.transactionClassifier = transactionClassifier;
        this.logger = logger;
        this.protocolVersions = protocolVersions;
        this.cache = cache;
        this.multiOrgEnabled = multiOrgEnabled;
        this.overlays = overlays ?? [];
    }

    /**
     * Read-through cache wrapper around {@link evaluate}. The decision is a pure
     * function of the inputs and policy state, so a hit is safe. Only successful
     * evaluations are cached: an internal error throws out of `evaluate` before
     * `set`, so it stays fail-closed and uncached.
     */
    async judge(input: JudgeInput): Promise<AuthorizationResult> {
        const capability = await withDecisionCache(
            this.cache,
            'judge',
            ['judge', input.protocolVersion, input.accessType, JSON.stringify(serializeFrame(input.trace.frame))],
            () => this.evaluate(input)
        );

        const rootFrame = input.trace.frame;
        if (!capability.authorized || rootFrame === null || this.overlays.length === 0) {
            return capability;
        }

        // Same as admit: a simulated read moves nothing, so putting it to limits and
        // approvals would refuse `eth_call` and gas estimation for a routed operation.
        if (input.accessType === 'read') {
            return capability;
        }

        // Narrowing only, and outside the cache, as in `AdmitService`. `isUmbrella` is
        // not honoured here: the row that prunes a subtree is what would hide a routed
        // transfer, so a limit a permission row can switch off is not a limit.
        for (const overlay of this.overlays) {
            const verdict = await this.overlayTraceVerdict(overlay, rootFrame, rootFrame.caller);
            if (verdict !== undefined && !verdict.authorized) {
                return verdict;
            }
        }
        return capability;
    }

    /** Fail-closed: an enabled overlay that throws is a denial, unless it raised a
     * verdict of its own, which is not an outage. */
    private async overlayTraceVerdict(
        overlay: AuthorizationOverlay,
        root: TraceFrame,
        signerAddress: Address
    ): Promise<AuthorizationResult | undefined> {
        try {
            return await overlay.checkTrace({ signerAddress, root });
        } catch (error) {
            if (error instanceof OverlayRefusal) {
                return error.verdict;
            }
            // Fixed reason for the same disclosure reason as admit: this string is returned
            // to the sequencer and persisted to the denial ledger.
            this.logger.error({ err: error }, 'authorization overlay threw on judge');
            return OVERLAY_UNAVAILABLE;
        }
    }

    private async evaluate(input: JudgeInput): Promise<AuthorizationResult> {
        if (!this.protocolVersions.includes(input.protocolVersion)) {
            return {
                authorized: false,
                ruleId: 'protocol.version_mismatch',
                reason: `protocolVersion mismatch (got "${input.protocolVersion}", supported [${this.protocolVersions.map((v) => `"${v}"`).join(', ')}])`
            };
        }

        const rootFrame = input.trace.frame;
        if (rootFrame === null) {
            return { authorized: true, ruleId: 'judge.no_frames' };
        }

        const signer = rootFrame.caller;
        const user = await this.repos.users.findByAddressWithRoles(signer);
        if (user === undefined) {
            return { authorized: false, ruleId: 'user.not_found' };
        }

        // Root umbrella short-circuits the whole trace. Admit already
        // approved the root but didn't surface the row's `umbrella` flag.
        // Re-fetch it here just to read that. Don't deny on lookup failure:
        // admit accepted this tx, and denying here would create an
        // admit/judge split.
        //
        // The re-fetch also normalizes timing: every non-constructor root
        // frame does one DB round-trip regardless of subtree size. Skipping
        // it for childless traces would create a timing oracle leaking
        // whether the root permission exists — a real side channel in a
        // permissioned proxy where the permission set itself can be
        // confidential.
        if (rootFrame.callKind !== 'constructor') {
            const calldata: Hex = size(rootFrame.calldata) === 0 ? '0x' : rootFrame.calldata;
            const contractAddress = rootFrame.callKind === 'delegateCall' ? rootFrame.caller : rootFrame.callee;
            const rootDecision = await this.authorizationService.checkMethodAuthorizationForUser({
                fromAddress: signer,
                user,
                contractAddress,
                calldata,
                accessTypeCheck: input.accessType
            });
            if (rootDecision.authorized && rootDecision.isUmbrella === true) {
                if (!this.multiOrgEnabled) {
                    return { authorized: true, ruleId: 'judge.allow' };
                }
                return this.checkSubtree(signer, user, rootFrame.children, true);
            }
        }

        return this.checkSubtree(signer, user, rootFrame.children);
    }

    private async checkSubtree(
        signer: Address,
        user: UserWithRoles,
        frames: TraceFrame[],
        covered = false
    ): Promise<AuthorizationResult> {
        // Evaluate the call tree generation by generation (breadth first). Each
        // generation's per-frame permission lookups are collapsed into a handful
        // of set-based queries (see `AuthorizationService.checkUserAuthorizationForCalls`),
        // so judge cost scales with tree depth rather than frame count.
        //
        // The decision surfaced is still the one the original sequential
        // depth-first walk would surface: the first deny (or evaluation throw)
        // in pre-order, else allow. `resolveDepthFirst` reconstructs that order
        // over the recorded per-frame outcomes. The breadth-first pass may
        // evaluate frames the depth-first walk would skip after the first deny,
        // which only adds work on the rejection path.
        const evaluations = new Map<TraceFrame, FrameEvaluation>();
        let frontier: CoveredFrame[] = frames.map((frame) => ({ frame, covered }));

        while (frontier.length > 0) {
            const generation = frontier.filter((f) => f.frame.callKind !== 'constructor');
            await this.evaluateFrames(signer, user, generation, evaluations);

            // Enqueue the next generation. Constructor frames have no row and
            // always recurse. A denied or erroring frame is not descended into
            // (the depth-first walk would not reach its subtree). Umbrella
            // coverage is inherited by everything below the frame that carries it.
            const next: CoveredFrame[] = [];
            for (const { frame, covered: inherited } of frontier) {
                if (frame.callKind === 'constructor') {
                    next.push(...frame.children.map((child) => ({ frame: child, covered: inherited })));
                    continue;
                }
                const evaluation = evaluations.get(frame)!;
                if (evaluation.kind === 'error') continue;
                const decision = evaluation.result;
                if (!decision.authorized) continue;
                const umbrella = decision.isUmbrella === true;
                if (umbrella && !this.multiOrgEnabled) continue;
                const childCoverage = inherited || umbrella;
                next.push(...frame.children.map((child) => ({ frame: child, covered: childCoverage })));
            }
            frontier = next;
        }

        return this.resolveDepthFirst(frames, evaluations);
    }

    /**
     * Records one generation of non-constructor frames into `evaluations`: a bare
     * native transfer to an EOA is allowed without a permission row (like admit);
     * the rest go through a single batched permission lookup. Only a plain CALL
     * moves value to the callee, so delegate/static calls are evaluated as method calls.
     */
    private async evaluateFrames(
        signer: Address,
        user: UserWithRoles,
        frames: CoveredFrame[],
        evaluations: Map<TraceFrame, FrameEvaluation>
    ): Promise<void> {
        const classified = await Promise.all(
            frames.map(async ({ frame, covered }) => ({
                frame,
                covered,
                isTransferToEoa:
                    frame.callKind === 'call' &&
                    (
                        await this.transactionClassifier.classifyTransaction(
                            frame.callee,
                            (size(frame.calldata) === 0 ? '0x' : frame.calldata) as Hex,
                            BigInt(frame.value)
                        )
                    ).type === 'transfer-to-eoa'
            }))
        );
        for (const { frame, isTransferToEoa } of classified) {
            if (isTransferToEoa) {
                evaluations.set(frame, {
                    kind: 'result',
                    result: { authorized: true, ruleId: 'transfer.native.allow' }
                });
            }
        }

        // delegateCall resolves against `caller` (the proxy address rules are
        // registered against), not `callee`; the selector is unchanged so
        // `(caller, selector)` matches. Inner frames are unenforced: the row's
        // own classification governs mid-trace.
        const toLookup = classified.filter((c) => !c.isTransferToEoa);
        if (toLookup.length > 0) {
            const calls = toLookup.map(({ frame: f, covered }) => ({
                contractAddress: f.callKind === 'delegateCall' ? f.caller : f.callee,
                calldata: (size(f.calldata) === 0 ? '0x' : f.calldata) as Hex,
                umbrellaCovered: covered
            }));
            const results = await this.authorizationService.checkUserAuthorizationForCalls({
                fromAddress: signer,
                user,
                calls,
                accessTypeCheck: 'unenforced'
            });
            toLookup.forEach(({ frame }, i) => {
                evaluations.set(frame, results[i]!);
            });
        }
    }

    /**
     * Walks the call tree in the same pre-order the original sequential
     * `checkSubtree` used and returns the first decisive outcome: a deny is
     * returned, an evaluation error is re-thrown (fail-closed, exactly where the
     * sequential walk would have thrown), an umbrella allow prunes its subtree,
     * and a plain allow recurses. Frames the breadth-first pass did not reach
     * (pruned subtree, or under a denied ancestor) are not visited here either.
     */
    private resolveDepthFirst(
        frames: TraceFrame[],
        evaluations: Map<TraceFrame, FrameEvaluation>
    ): AuthorizationResult {
        for (const frame of frames) {
            // Constructor frames have no permission row of their own; fall
            // through to recurse into their children. Non-constructor frames
            // are decided first, and only a plain allow recurses.
            if (frame.callKind !== 'constructor') {
                const evaluation = evaluations.get(frame);
                if (evaluation === undefined) continue;
                if (evaluation.kind === 'error') throw evaluation.error;

                const decision = evaluation.result;
                if (!decision.authorized) return decision;
                if (decision.isUmbrella === true && !this.multiOrgEnabled) continue;
            }

            const childResult = this.resolveDepthFirst(frame.children, evaluations);
            if (!childResult.authorized) return childResult;
        }

        return { authorized: true, ruleId: 'judge.allow' };
    }
}
