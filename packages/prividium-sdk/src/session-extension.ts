// Mirrors the idle-session scheduler in the Prividium user panel: same activity-gated
// extend loop and warning-timer logic. Behaviour changes must land in both.

import type { PrividiumConfig, SessionExpiringInfo, TokenData } from './types.js';

// ---------------------------------------------------------------------------
// Structural interface for the subset of TokenManager the scheduler uses.
// Using a structural type keeps the scheduler decoupled from storage.ts and
// lets tests inject plain stub objects.
// ---------------------------------------------------------------------------

export interface TokenManagerLike {
    getToken(): TokenData | null;
    isLegacyFixedExpiry(): boolean;
    extend(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal document/window abstraction (injected for testability)
// ---------------------------------------------------------------------------

interface DocLike {
    addEventListener(type: string, fn: (e: Event) => void): void;
    removeEventListener(type: string, fn: (e: Event) => void): void;
    visibilityState: DocumentVisibilityState;
}

interface WinLike {
    addEventListener(type: string, fn: (e: Event) => void): void;
    removeEventListener(type: string, fn: (e: Event) => void): void;
}

// ---------------------------------------------------------------------------
// Scheduler options
// ---------------------------------------------------------------------------

export interface SessionExtensionSchedulerOptions {
    tokenManager: TokenManagerLike;
    /** Subset of PrividiumConfig needed by the scheduler */
    config: Pick<PrividiumConfig, 'idleCheckInterval' | 'warningLeadTime' | 'onSessionExpiring'>;
    /** Injected for tests; defaults to globalThis.document when omitted */
    doc?: DocLike;
    /** Injected for tests; defaults to globalThis.window when omitted */
    win?: WinLike;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum safe delay for setTimeout (signed 32-bit integer limit ~24.8 days).
 * Passing a larger value causes the timer to fire almost immediately.
 */
const MAX_SETTIMEOUT_DELAY = 2_147_483_647;

// ---------------------------------------------------------------------------
// SessionExtensionScheduler
// ---------------------------------------------------------------------------

/**
 * Owns the activity-gated extend loop, the warning timer, and the
 * visibility/focus re-check for the popup chain.
 *
 * Usage:
 *   const sched = new SessionExtensionScheduler({ tokenManager, config });
 *   sched.start();                // arm timers + listeners
 *   sched.stampActivity();        // call on every authenticated request
 *   sched.teardown();             // on unauthorize() / token clear
 */
export class SessionExtensionScheduler {
    private readonly tm: TokenManagerLike;
    private readonly idleCheckInterval: number;
    private readonly warningLeadTime: number;
    private readonly onSessionExpiring: PrividiumConfig['onSessionExpiring'];

    private readonly doc: DocLike | null;
    private readonly win: WinLike | null;

    /** True when at least one request has been made since the last extend. */
    private activitySinceLastExtend = false;

    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private warningHandle: ReturnType<typeof setTimeout> | null = null;

    /**
     * True once onSessionExpiring has been fired for the current expiresAt
     * deadline. Reset to false in scheduleWarning() so each new deadline
     * (after an extend or re-arm) gets exactly one warning emission.
     */
    private warned = false;

    // Bound handlers kept as instance members so removeEventListener works
    private readonly onVisibilityChange: () => void;
    private readonly onFocus: () => void;

    constructor(opts: SessionExtensionSchedulerOptions) {
        this.tm = opts.tokenManager;
        this.idleCheckInterval = opts.config.idleCheckInterval ?? 300_000;
        this.warningLeadTime = opts.config.warningLeadTime ?? 60_000;
        this.onSessionExpiring = opts.config.onSessionExpiring;

        // Resolve doc/win from injection or globals, guarding against non-browser envs
        this.doc = opts.doc ?? (typeof document !== 'undefined' ? (document as DocLike) : null);
        this.win = opts.win ?? (typeof window !== 'undefined' ? (window as WinLike) : null);

        this.onVisibilityChange = () => {
            if (this.doc?.visibilityState === 'visible') {
                this.checkAndMaybeWarn();
            }
        };
        this.onFocus = () => {
            this.checkAndMaybeWarn();
        };
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /** Stamp that an authenticated request just happened. */
    stampActivity(): void {
        this.activitySinceLastExtend = true;
    }

    /** Arm the extend loop, warning timer, and visibility/focus listeners. */
    start(): void {
        // Guard: legacy fixed-expiry sessions cannot be extended; skip entirely.
        if (this.tm.isLegacyFixedExpiry()) {
            // Still arm the warning timer (the session will still expire)
            this.scheduleWarning();
            this.attachListeners();
            return;
        }

        this.scheduleIdleCheck();
        this.scheduleWarning();
        this.attachListeners();
    }

    /** Clear all timers and event listeners. Call on unauthorize(). */
    teardown(): void {
        this.clearIdleCheck();
        this.clearWarning();
        this.detachListeners();
    }

    // -----------------------------------------------------------------------
    // Idle extend loop
    // -----------------------------------------------------------------------

    private scheduleIdleCheck(): void {
        this.clearIdleCheck();
        this.intervalHandle = setInterval(() => {
            void this.onIdleTick();
        }, this.idleCheckInterval);
    }

    private clearIdleCheck(): void {
        if (this.intervalHandle !== null) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    private async onIdleTick(): Promise<void> {
        if (!this.activitySinceLastExtend) {
            // No activity since the last extend — do nothing this interval.
            return;
        }

        // Reset the gate before the async extend so a concurrent request stamps
        // correctly regardless of timing.
        this.activitySinceLastExtend = false;

        await this.tm.extend();

        // Reschedule warning against the (possibly updated) expiresAt.
        this.scheduleWarning();
    }

    // -----------------------------------------------------------------------
    // Warning timer
    // -----------------------------------------------------------------------

    private scheduleWarning(): void {
        this.clearWarning();
        // Reset the de-dupe flag so the next approach to this (possibly new)
        // deadline fires exactly one warning.
        this.warned = false;

        if (!this.onSessionExpiring) {
            return;
        }

        const token = this.tm.getToken();
        if (!token) {
            return;
        }

        const msUntilExpiry = token.expiresAt.getTime() - Date.now();
        const delay = msUntilExpiry - this.warningLeadTime;

        if (delay <= 0) {
            // Already within the warning window — fire immediately (async to
            // avoid re-entrancy inside scheduleWarning callers).
            Promise.resolve()
                .then(() => this.fireWarning())
                .catch(() => {});
            return;
        }

        // Guard against signed-32-bit overflow: if delay exceeds the max safe
        // setTimeout value (~24.8 days), the timer would fire almost immediately.
        // Instead, re-arm at the max and let the next scheduleWarning call get
        // closer to the real deadline.
        if (delay > MAX_SETTIMEOUT_DELAY) {
            this.warningHandle = setTimeout(() => {
                this.scheduleWarning();
            }, MAX_SETTIMEOUT_DELAY);
            return;
        }

        this.warningHandle = setTimeout(() => {
            void this.fireWarning();
        }, delay);
    }

    private clearWarning(): void {
        if (this.warningHandle !== null) {
            clearTimeout(this.warningHandle);
            this.warningHandle = null;
        }
    }

    private async fireWarning(): Promise<void> {
        if (!this.onSessionExpiring) {
            return;
        }

        // De-dupe: only fire once per deadline. scheduleWarning() resets this.
        if (this.warned) {
            return;
        }
        this.warned = true;

        const token = this.tm.getToken();
        if (!token) {
            return;
        }

        const { expiresAt, renewableUntil } = token;
        const secondsRemaining = Math.max(0, (expiresAt.getTime() - Date.now()) / 1000);

        // canExtend: true only when we're NOT at the absolute cap
        const canExtend = expiresAt.getTime() < renewableUntil.getTime();

        const info: SessionExpiringInfo = {
            expiresAt,
            renewableUntil,
            secondsRemaining,
            canExtend,
            extend: async () => {
                await this.tm.extend();
                this.scheduleWarning();
            }
        };

        this.onSessionExpiring(info);
    }

    // -----------------------------------------------------------------------
    // Visibility / focus re-check
    // -----------------------------------------------------------------------

    private attachListeners(): void {
        this.doc?.addEventListener('visibilitychange', this.onVisibilityChange);
        this.win?.addEventListener('focus', this.onFocus);
    }

    private detachListeners(): void {
        this.doc?.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.win?.removeEventListener('focus', this.onFocus);
    }

    /**
     * Re-check expiry against the wall clock.  Called on visibility/focus
     * because background-tab timers can be heavily throttled.
     */
    private checkAndMaybeWarn(): void {
        // De-dupe: if the warning already fired for this deadline, skip.
        if (this.warned) {
            return;
        }

        const token = this.tm.getToken();
        if (!token) {
            return;
        }

        const msUntilExpiry = token.expiresAt.getTime() - Date.now();

        if (msUntilExpiry <= this.warningLeadTime && this.onSessionExpiring) {
            // Already within the warning window — fire immediately.
            this.clearWarning();
            Promise.resolve()
                .then(() => this.fireWarning())
                .catch(() => {});
        }
    }
}
