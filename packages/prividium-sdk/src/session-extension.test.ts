import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionExtensionScheduler } from './session-extension.js';
import type { SessionExpiringInfo } from './types.js';

// ---------------------------------------------------------------------------
// Minimal TokenManager stub — only the methods the scheduler uses
// ---------------------------------------------------------------------------

interface TokenManagerStub {
    getToken: ReturnType<typeof vi.fn>;
    isLegacyFixedExpiry: ReturnType<typeof vi.fn>;
    extend: ReturnType<typeof vi.fn>;
    clearToken: ReturnType<typeof vi.fn>;
    /** Test helper: override the deadline returned by getToken */
    setExpiresAt(d: Date): void;
}

function makeTokenManager({
    expiresAt,
    renewableUntil,
    legacy = false
}: {
    expiresAt: Date;
    renewableUntil: Date;
    legacy?: boolean;
}): TokenManagerStub {
    let currentExpiresAt = expiresAt;
    const manager: TokenManagerStub = {
        getToken: vi.fn(() => ({ rawToken: 'tok', expiresAt: currentExpiresAt, renewableUntil })),
        isLegacyFixedExpiry: vi.fn(() => legacy),
        extend: vi.fn(async () => {
            // Simulate a successful extend: push expiresAt forward by 5 minutes
            currentExpiresAt = new Date(currentExpiresAt.getTime() + 5 * 60 * 1000);
        }),
        clearToken: vi.fn(),
        setExpiresAt(d: Date) {
            currentExpiresAt = d;
        }
    };
    return manager;
}

// ---------------------------------------------------------------------------
// Minimal document/window stub for visibility + focus events
// ---------------------------------------------------------------------------

type Listener = (e: Event) => void;

function makeWindowStub() {
    const docListeners = new Map<string, Listener[]>();
    const winListeners = new Map<string, Listener[]>();

    const doc = {
        addEventListener: vi.fn((type: string, fn: Listener) => {
            if (!docListeners.has(type)) docListeners.set(type, []);
            docListeners.get(type)!.push(fn);
        }),
        removeEventListener: vi.fn((type: string, fn: Listener) => {
            const arr = docListeners.get(type) ?? [];
            const idx = arr.indexOf(fn);
            if (idx !== -1) arr.splice(idx, 1);
        }),
        visibilityState: 'visible' as DocumentVisibilityState,
        triggerVisibilityChange(state: DocumentVisibilityState) {
            this.visibilityState = state;
            const event = new Event('visibilitychange');
            for (const fn of docListeners.get('visibilitychange') ?? []) fn(event);
        }
    };

    const win = {
        addEventListener: vi.fn((type: string, fn: Listener) => {
            if (!winListeners.has(type)) winListeners.set(type, []);
            winListeners.get(type)!.push(fn);
        }),
        removeEventListener: vi.fn((type: string, fn: Listener) => {
            const arr = winListeners.get(type) ?? [];
            const idx = arr.indexOf(fn);
            if (idx !== -1) arr.splice(idx, 1);
        }),
        triggerFocus() {
            const event = new Event('focus');
            for (const fn of winListeners.get('focus') ?? []) fn(event);
        }
    };

    return { doc, win };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IDLE_INTERVAL = 300_000; // 5 min
const WARN_LEAD = 60_000; // 1 min

function minutesFromNow(m: number): Date {
    return new Date(Date.now() + m * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionExtensionScheduler', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('issues at most one extend-session per check interval while active', async () => {
        // expiresAt far enough away that no warning timer fires during this test
        const expiresAt = minutesFromNow(30);
        const renewableUntil = minutesFromNow(120);
        const tm = makeTokenManager({ expiresAt, renewableUntil });

        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: { idleCheckInterval: IDLE_INTERVAL, warningLeadTime: WARN_LEAD },
            doc,
            win
        });

        scheduler.start();

        // Simulate two activity stamps before the first interval fires
        scheduler.stampActivity();
        scheduler.stampActivity();

        // Advance past one interval
        await vi.advanceTimersByTimeAsync(IDLE_INTERVAL + 1);

        expect(tm.extend).toHaveBeenCalledTimes(1);

        // Stamp again, then advance a second interval
        scheduler.stampActivity();
        await vi.advanceTimersByTimeAsync(IDLE_INTERVAL);

        expect(tm.extend).toHaveBeenCalledTimes(2);

        scheduler.teardown();
    });

    it('issues no extend-session across an interval with no activity', async () => {
        const expiresAt = minutesFromNow(30);
        const renewableUntil = minutesFromNow(120);
        const tm = makeTokenManager({ expiresAt, renewableUntil });

        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: { idleCheckInterval: IDLE_INTERVAL, warningLeadTime: WARN_LEAD },
            doc,
            win
        });

        scheduler.start();

        // No activity stamps at all

        // Advance past two full intervals
        await vi.advanceTimersByTimeAsync(IDLE_INTERVAL * 2 + 1);

        expect(tm.extend).not.toHaveBeenCalled();

        scheduler.teardown();
    });

    it('issues zero extend calls in legacy fixed-expiry mode', async () => {
        const expiresAt = minutesFromNow(30);
        // Same value = legacy
        const renewableUntil = expiresAt;
        const tm = makeTokenManager({ expiresAt, renewableUntil, legacy: true });

        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: { idleCheckInterval: IDLE_INTERVAL, warningLeadTime: WARN_LEAD },
            doc,
            win
        });

        scheduler.start();
        scheduler.stampActivity();

        await vi.advanceTimersByTimeAsync(IDLE_INTERVAL * 3 + 1);

        expect(tm.extend).not.toHaveBeenCalled();

        scheduler.teardown();
    });

    it('fires onSessionExpiring warningLeadTime before idle expiry with canExtend true below the cap', async () => {
        // Session expires in 10 minutes, absolute cap in 60 minutes
        const expiresAt = minutesFromNow(10);
        const renewableUntil = minutesFromNow(60);
        const tm = makeTokenManager({ expiresAt, renewableUntil });

        const onSessionExpiring = vi.fn();
        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: {
                idleCheckInterval: IDLE_INTERVAL,
                warningLeadTime: WARN_LEAD,
                onSessionExpiring
            },
            doc,
            win
        });

        scheduler.start();

        // Warning fires at expiresAt - warningLeadTime = 10min - 1min = 9 minutes from now
        const warningDelay = 10 * 60 * 1000 - WARN_LEAD;

        // Not yet
        await vi.advanceTimersByTimeAsync(warningDelay - 1);
        expect(onSessionExpiring).not.toHaveBeenCalled();

        // Exactly at warning time
        await vi.advanceTimersByTimeAsync(1);
        expect(onSessionExpiring).toHaveBeenCalledTimes(1);

        const info = onSessionExpiring.mock.calls[0][0] as SessionExpiringInfo;
        expect(info.canExtend).toBe(true);
        expect(info.expiresAt).toEqual(expiresAt);
        expect(info.renewableUntil).toEqual(renewableUntil);
        expect(info.secondsRemaining).toBeGreaterThan(0);
        expect(typeof info.extend).toBe('function');

        // Invoke the extend callback — it should call tokenManager.extend and
        // reschedule the warning (resetting the warned flag for the new deadline).
        const extendCallsBefore = (tm.extend as ReturnType<typeof vi.fn>).mock.calls.length;
        await info.extend();
        expect((tm.extend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(extendCallsBefore + 1);

        // After the extend the warned flag is reset; a fresh warning should be
        // schedulable again (the scheduler must not be stuck in "already warned").
        onSessionExpiring.mockClear();
        // Advance to the new warning time (expiresAt pushed +5 min, new lead window at +4 min from new expiry)
        // expiresAt was 10 min from now; after extend it's ~15 min from test start.
        // Warning fires at newExpiresAt - 1 min. Drive time forward enough to reach it.
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
        expect(onSessionExpiring).toHaveBeenCalledTimes(1);

        scheduler.teardown();
    });

    it('fires onSessionExpiring with canExtend false once expiresAt reaches renewableUntil', async () => {
        // expiresAt === renewableUntil (at the cap)
        const expiresAt = minutesFromNow(10);
        const renewableUntil = minutesFromNow(10); // same value = at cap
        // Not legacy because we don't mark it legacy here; canExtend is determined by deadline comparison
        const tm = makeTokenManager({ expiresAt, renewableUntil, legacy: false });

        const onSessionExpiring = vi.fn();
        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: {
                idleCheckInterval: IDLE_INTERVAL,
                warningLeadTime: WARN_LEAD,
                onSessionExpiring
            },
            doc,
            win
        });

        scheduler.start();

        const warningDelay = 10 * 60 * 1000 - WARN_LEAD;
        await vi.advanceTimersByTimeAsync(warningDelay + 1);

        expect(onSessionExpiring).toHaveBeenCalledTimes(1);
        const info = onSessionExpiring.mock.calls[0][0] as SessionExpiringInfo;
        expect(info.canExtend).toBe(false);

        scheduler.teardown();
    });

    it('reschedules the warning timer after a successful extend', async () => {
        // Session expires in 10 minutes, absolute cap in 60 minutes.
        // makeTokenManager's extend() pushes expiresAt forward by 5 minutes.
        const startNow = Date.now();
        const expiresAt = minutesFromNow(10);
        const renewableUntil = minutesFromNow(60);
        const tm = makeTokenManager({ expiresAt, renewableUntil });

        const onSessionExpiring = vi.fn();
        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: {
                idleCheckInterval: IDLE_INTERVAL,
                warningLeadTime: WARN_LEAD,
                onSessionExpiring
            },
            doc,
            win
        });

        scheduler.start();

        // Stamp activity and trigger an extend (via the idle check loop)
        scheduler.stampActivity();

        // Advance to first idle check (5 min) — extend fires, pushes expiresAt to 15 min from start
        await vi.advanceTimersByTimeAsync(IDLE_INTERVAL + 1);
        expect(tm.extend).toHaveBeenCalledTimes(1);

        // Original warning was at startNow + 9 min (10min - 1min lead).
        // After extend, new expiresAt = startNow + 15 min, so new warning at startNow + 14 min.
        const originalWarningMs = startNow + 10 * 60 * 1000 - WARN_LEAD;
        const elapsedSoFar = IDLE_INTERVAL + 1;

        // Advance to original warning time — warning should NOT fire there.
        const toOriginalWarning = originalWarningMs - startNow - elapsedSoFar;
        if (toOriginalWarning > 0) {
            await vi.advanceTimersByTimeAsync(toOriginalWarning);
        }
        expect(onSessionExpiring).not.toHaveBeenCalled();

        // Advance to new warning time: new expiresAt = startNow + 15 min, warning at startNow + 14 min.
        // Total elapsed so far = IDLE_INTERVAL + 1 + toOriginalWarning ~= 9 min from start.
        // New warning is at 14 min from start → need to advance ~5 more minutes.
        const newExpiresAtMs = startNow + 15 * 60 * 1000; // extend adds 5 min to original 10
        const newWarningMs = newExpiresAtMs - WARN_LEAD;
        const currentElapsed = elapsedSoFar + Math.max(0, toOriginalWarning);
        const toNewWarning = newWarningMs - startNow - currentElapsed;

        await vi.advanceTimersByTimeAsync(toNewWarning + 1);

        // Warning MUST fire at the new (rescheduled) deadline — exactly once.
        expect(onSessionExpiring).toHaveBeenCalledTimes(1);

        scheduler.teardown();
    });

    it('re-checks expiry on visibilitychange when the tab becomes visible', async () => {
        // Session expires in 5 minutes; warning lead is 1 minute.
        // So the warning timer is scheduled for 4 minutes from now (5min - 1min).
        // We simulate the tab being hidden so the timer never fires, then the tab
        // becomes visible with only 30 seconds remaining — the re-check should fire
        // onSessionExpiring immediately.
        const expiresAt = minutesFromNow(5);
        const renewableUntil = minutesFromNow(60);
        const tm = makeTokenManager({ expiresAt, renewableUntil });

        const onSessionExpiring = vi.fn();
        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: {
                idleCheckInterval: IDLE_INTERVAL,
                warningLeadTime: WARN_LEAD,
                onSessionExpiring
            },
            doc,
            win
        });

        scheduler.start();

        // Confirm nothing has fired yet
        await Promise.resolve();
        expect(onSessionExpiring).not.toHaveBeenCalled();

        // Simulate time passing while the tab was hidden (timers throttled).
        // Now only 30 seconds remain — well within warningLeadTime (60s).
        // Update the stub so getToken() reflects the new imminent deadline.
        const imminentExpiry = new Date(Date.now() + 30 * 1000);
        tm.setExpiresAt(imminentExpiry);

        // Tab becomes visible — scheduler should detect we're within the warning
        // window and fire onSessionExpiring immediately.
        doc.triggerVisibilityChange('visible');

        await Promise.resolve();

        expect(onSessionExpiring).toHaveBeenCalledTimes(1);
        const info = onSessionExpiring.mock.calls[0][0] as SessionExpiringInfo;
        expect(info.canExtend).toBe(true);

        scheduler.teardown();
    });

    it('re-checks expiry on window focus when within the lead window', async () => {
        // Mirror of the visibilitychange test but uses window focus event.
        const expiresAt = minutesFromNow(5);
        const renewableUntil = minutesFromNow(60);
        const tm = makeTokenManager({ expiresAt, renewableUntil });

        const onSessionExpiring = vi.fn();
        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: {
                idleCheckInterval: IDLE_INTERVAL,
                warningLeadTime: WARN_LEAD,
                onSessionExpiring
            },
            doc,
            win
        });

        scheduler.start();

        await Promise.resolve();
        expect(onSessionExpiring).not.toHaveBeenCalled();

        // Simulate time passing while window was out of focus (timer throttled).
        // Now only 30 seconds remain — well within warningLeadTime (60s).
        const imminentExpiry = new Date(Date.now() + 30 * 1000);
        tm.setExpiresAt(imminentExpiry);

        // Window gains focus — scheduler should detect we're within the warning
        // window and fire onSessionExpiring immediately.
        win.triggerFocus();

        await Promise.resolve();

        expect(onSessionExpiring).toHaveBeenCalledTimes(1);
        const callInfo = onSessionExpiring.mock.calls[0][0] as SessionExpiringInfo;
        expect(callInfo.canExtend).toBe(true);

        scheduler.teardown();
    });

    it('fires onSessionExpiring exactly once even when timer and focus/visibility overlap', async () => {
        // Regression test: the warned flag must prevent double-fire
        // when both the setTimeout fires AND a focus/visibilitychange event arrives
        // while still within the lead window.
        const expiresAt = minutesFromNow(10);
        const renewableUntil = minutesFromNow(60);
        const tm = makeTokenManager({ expiresAt, renewableUntil });

        const onSessionExpiring = vi.fn();
        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: {
                idleCheckInterval: IDLE_INTERVAL,
                warningLeadTime: WARN_LEAD,
                onSessionExpiring
            },
            doc,
            win
        });

        scheduler.start();

        // Advance to just past the warning timer fire point (9 min from now)
        const warningDelay = 10 * 60 * 1000 - WARN_LEAD;
        await vi.advanceTimersByTimeAsync(warningDelay + 1);

        // Timer has now fired — onSessionExpiring called once
        expect(onSessionExpiring).toHaveBeenCalledTimes(1);

        // Simulate a focus event arriving while still in the warning window
        // (common when returning to tab just as the warning fires).
        win.triggerFocus();
        await Promise.resolve();

        // Must still be exactly one call — the warned flag prevents double-fire.
        expect(onSessionExpiring).toHaveBeenCalledTimes(1);

        // A visibilitychange event also must not re-fire.
        doc.triggerVisibilityChange('visible');
        await Promise.resolve();

        expect(onSessionExpiring).toHaveBeenCalledTimes(1);

        scheduler.teardown();
    });

    // -----------------------------------------------------------------------
    // MAX_SETTIMEOUT_DELAY clamp — overflow guard
    // -----------------------------------------------------------------------

    it('does NOT fire onSessionExpiring immediately when expiresAt is beyond the 32-bit setTimeout limit (~24.8 days)', async () => {
        // A deadline beyond MAX_SETTIMEOUT_DELAY (~2.147e9 ms ≈ 24.8 days) would
        // cause a plain setTimeout(fn, delay) to fire almost immediately due to
        // 32-bit signed integer overflow. The scheduler must clamp and re-arm
        // instead of firing onSessionExpiring at once.
        const MAX_SETTIMEOUT_DELAY = 2_147_483_647;

        // expiresAt: well beyond the 32-bit limit (50 days from now).
        const farFuture = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000);
        const renewableUntil = new Date(farFuture.getTime() + 60 * 60 * 1000); // 1h past that

        const tm = makeTokenManager({ expiresAt: farFuture, renewableUntil });

        const onSessionExpiring = vi.fn();
        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: {
                idleCheckInterval: IDLE_INTERVAL,
                warningLeadTime: WARN_LEAD,
                onSessionExpiring
            },
            doc,
            win
        });

        scheduler.start();

        // Advance by the max setTimeout delay (one re-arm cycle) — the callback
        // must NOT have fired onSessionExpiring yet; it should only re-schedule.
        await vi.advanceTimersByTimeAsync(MAX_SETTIMEOUT_DELAY);
        expect(onSessionExpiring).not.toHaveBeenCalled();

        scheduler.teardown();
    });

    it('clears timers and listeners on teardown', async () => {
        const expiresAt = minutesFromNow(10);
        const renewableUntil = minutesFromNow(60);
        const tm = makeTokenManager({ expiresAt, renewableUntil });

        const onSessionExpiring = vi.fn();
        const { doc, win } = makeWindowStub();

        const scheduler = new SessionExtensionScheduler({
            tokenManager: tm,
            config: {
                idleCheckInterval: IDLE_INTERVAL,
                warningLeadTime: WARN_LEAD,
                onSessionExpiring
            },
            doc,
            win
        });

        scheduler.start();
        scheduler.stampActivity();

        // Capture the exact handler references that were registered
        const docAddCalls = (doc.addEventListener as ReturnType<typeof vi.fn>).mock.calls;
        const winAddCalls = (win.addEventListener as ReturnType<typeof vi.fn>).mock.calls;
        const visibilityHandler = docAddCalls.find(([type]) => type === 'visibilitychange')?.[1] as Listener;
        const focusHandler = winAddCalls.find(([type]) => type === 'focus')?.[1] as Listener;
        expect(visibilityHandler).toBeDefined();
        expect(focusHandler).toBeDefined();

        // Teardown before any interval fires
        scheduler.teardown();

        // removeEventListener must have been called with the exact event types
        // and the same bound handler references that were passed to addEventListener.
        const docRemoveCalls = (doc.removeEventListener as ReturnType<typeof vi.fn>).mock.calls;
        const winRemoveCalls = (win.removeEventListener as ReturnType<typeof vi.fn>).mock.calls;

        expect(docRemoveCalls.some(([type, fn]) => type === 'visibilitychange' && fn === visibilityHandler)).toBe(true);
        expect(winRemoveCalls.some(([type, fn]) => type === 'focus' && fn === focusHandler)).toBe(true);

        // After teardown, no extend AND no onSessionExpiring should happen
        // even if intervals + warning timers would have fired.
        await vi.advanceTimersByTimeAsync(IDLE_INTERVAL * 3 + 1);

        expect(tm.extend).not.toHaveBeenCalled();
        expect(onSessionExpiring).not.toHaveBeenCalled();
    });
});
