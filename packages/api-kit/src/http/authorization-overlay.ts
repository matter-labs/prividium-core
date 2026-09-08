import type { Address, Hex } from 'viem';

/**
 * A narrowing authorization stage a private feature contributes at the chain
 * boundary, declared here and called only by the open core.
 *
 * The core's capability gate decides first. An overlay sees only what that gate
 * already allowed and can turn it into a denial; it can never widen one. That
 * asymmetry is enforced at the call site rather than trusted to the overlay, so
 * an implementation that returns an allow cannot promote a denial even by
 * mistake — which matters more once the overlay is a separate service under
 * separate deployment.
 */

/** A feature derives its view from these fields, never from anything the caller stated. */
export type OverlaySubject = {
    from: Address;
    to?: Address;
    value: bigint;
    calldata: Hex;
};

/**
 * A rule id an overlay reports.
 *
 * Kept a template literal so the core admits a feature's decision sites without
 * enumerating them. `overlay.*` is the namespace reserved for ids a feature's own
 * decision sites report. The second arm admits a set of ids that predate this
 * namespace and that `zksync-os-server` maps back when it surfaces a rejection,
 * so renaming them needs a protocol version rather than a type change.
 *
 * The cost is that a union carrying this is no longer exhaustively checkable and
 * a typo inside the namespace is not caught. Nothing switches exhaustively on it
 * today and the wire schemas type it as a string.
 */
export type OverlayRuleId = `overlay.${string}` | `policy.${string}`;

export type OverlayVerdict = {
    authorized: boolean;
    ruleId?: OverlayRuleId;
    reason?: string;
};

/** Structural copy of the core's trace frame, so a feature never imports the core. */
export type OverlayFrame = {
    caller: Address;
    callee: Address;
    /** U256 hex, as the sequencer sends it. */
    value: string;
    calldata: Hex;
    callKind: 'call' | 'delegateCall' | 'staticCall' | 'constructor';
    children: OverlayFrame[];
};

/** The signer answers for the whole trace, as it does at the capability layer. */
export type OverlayTraceSubject = {
    signerAddress: Address;
    root: OverlayFrame;
};

export interface AuthorizationOverlay {
    /**
     * The overlay's verdict, or `undefined` when it has nothing to say about this
     * subject and the capability gate's result stands on its own.
     *
     * Throwing is a denial, not an error: an enabled overlay that cannot be
     * reached must not admit the transaction it was configured to judge. An
     * overlay that is simply absent is a different configuration and changes
     * nothing.
     */
    check(subject: OverlaySubject): Promise<OverlayVerdict | undefined>;

    /**
     * The frames beneath the root, which `check` never sees. Without it a governed
     * operation reached through a router meets no rule at all.
     */
    checkTrace(subject: OverlayTraceSubject): Promise<OverlayVerdict | undefined>;
}

/**
 * The verdict the core substitutes when an enabled overlay cannot be reached.
 *
 * Deliberately carries no detail from the underlying failure: this reason reaches
 * the sequencer and, through it, a rejection a caller can see. Diagnostics belong
 * in the log line the core writes beside it.
 */
export const OVERLAY_UNAVAILABLE: OverlayVerdict = {
    authorized: false,
    ruleId: 'overlay.unavailable',
    reason: 'the authorization overlay is enabled but could not be reached'
};

/** "I cannot judge this", as opposed to failing to run: `overlay.unavailable` must
 * stay alertable as an outage. */
export class OverlayRefusal extends Error {
    constructor(
        readonly verdict: OverlayVerdict,
        message?: string
    ) {
        super(message ?? verdict.reason ?? 'the authorization overlay refused this transaction');
    }
}
