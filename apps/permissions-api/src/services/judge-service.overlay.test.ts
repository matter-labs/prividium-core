import { type AuthorizationOverlay, OverlayRefusal, type OverlayVerdict } from '@repo/api-kit';
import { pad } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { Repositories } from '../db';
import type { AuthorizationService } from './authorization-service';
import { JudgeService, type TraceFrame } from './judge-service';
import type { TransactionClassifier } from './transaction-classifier';

/**
 * The trace path's half of the seam pinned in `admit-service.overlay.test.ts`: it can
 * only narrow, an overlay that cannot answer denies, and a verdict an overlay raises
 * rather than returns is still a verdict.
 */
describe('JudgeService — the overlay seam', () => {
    const PROTOCOL_VERSION = '1';
    const signer = pad('0x01', { size: 20 });

    /** A constructor root: the shortest path to a capability allow, no rows involved. */
    const root: TraceFrame = {
        caller: signer,
        callee: pad('0x02', { size: 20 }),
        value: '0x0',
        calldata: '0x',
        deploys: [],
        callKind: 'constructor',
        children: []
    };

    const write = {
        protocolVersion: PROTOCOL_VERSION,
        trace: { frame: root },
        accessType: 'write' as const
    };

    function serviceWithAll(overlays: AuthorizationOverlay[]) {
        const repos = {
            users: { findByAddressWithRoles: vi.fn().mockResolvedValue({ id: 'u1', roles: [] }) }
        } as unknown as Repositories;

        return new JudgeService({
            repos,
            authorizationService: {} as AuthorizationService,
            transactionClassifier: {} as TransactionClassifier,
            logger: { error: vi.fn() } as never,
            protocolVersions: [PROTOCOL_VERSION],
            ...(overlays.length === 0 ? {} : { overlays })
        });
    }

    const serviceWith = (overlay?: AuthorizationOverlay) => serviceWithAll(overlay === undefined ? [] : [overlay]);

    const overlayReturning = (verdict: OverlayVerdict | undefined) => ({
        check: vi.fn(),
        checkTrace: vi.fn().mockResolvedValue(verdict)
    });

    const overlayThrowing = (error: unknown) => ({
        check: vi.fn(),
        checkTrace: vi.fn().mockRejectedValue(error)
    });

    it('judges what the core judges when no overlay is registered', async () => {
        expect(await serviceWith().judge(write)).toMatchObject({ authorized: true });
    });

    it('lets an overlay narrow an allow into a denial', async () => {
        const overlay = overlayReturning({ authorized: false, ruleId: 'policy.rule.block', reason: 'blocked' });

        expect(await serviceWith(overlay).judge(write)).toMatchObject({
            authorized: false,
            ruleId: 'policy.rule.block'
        });
    });

    it('returns the capability result unchanged when the overlay allows', async () => {
        const overlay = overlayReturning({ authorized: true, ruleId: 'policy.rule.allow' });

        expect(await serviceWith(overlay).judge(write)).toMatchObject({ authorized: true });
    });

    it('fails closed as an outage when the overlay throws', async () => {
        const overlay = overlayThrowing(new Error('unreachable'));

        expect(await serviceWith(overlay).judge(write)).toMatchObject({
            authorized: false,
            ruleId: 'overlay.unavailable'
        });
    });

    it('reports a raised verdict as that verdict rather than an outage', async () => {
        const overlay = overlayThrowing(
            new OverlayRefusal(
                { authorized: false, ruleId: 'policy.frame.unclassifiable', reason: 'cannot classify' },
                'undecodable calldata'
            )
        );

        expect(await serviceWith(overlay).judge(write)).toMatchObject({
            authorized: false,
            ruleId: 'policy.frame.unclassifiable'
        });
    });

    it('stops at the first overlay that denies, so none of them can widen another', async () => {
        const deny = overlayReturning({ authorized: false, ruleId: 'policy.rule.block', reason: 'blocked' });
        const allow = overlayReturning({ authorized: true, ruleId: 'policy.rule.allow' });

        const result = await serviceWithAll([deny, allow]).judge(write);

        expect(result).toMatchObject({ authorized: false, ruleId: 'policy.rule.block' });
        expect(allow.checkTrace).not.toHaveBeenCalled();
    });

    it('leaves a read to the core, so preparing a transaction is not refused by policy', async () => {
        const overlay = overlayReturning({ authorized: false, ruleId: 'policy.rule.block' });

        const result = await serviceWith(overlay).judge({ ...write, accessType: 'read' });

        expect(result).toMatchObject({ authorized: true });
        expect(overlay.checkTrace).not.toHaveBeenCalled();
    });
});
