import { type AuthorizationOverlay, OverlayRefusal, type OverlayVerdict } from '@repo/api-kit';
import { pad } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { Repositories } from '../db';
import { AuthorizationService } from './authorization-service';
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
            authorizer: new AuthorizationService({ repos }),
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

    describe('confirming a transaction that cleared execution', () => {
        const txHash = pad('0x0a', { size: 32 });
        const executed = { ...write, txHash, moment: 'execution' as const };

        const confirming = (verdict?: OverlayVerdict) => ({
            ...overlayReturning(verdict),
            confirm: vi.fn().mockResolvedValue(undefined)
        });

        it('confirms once every check has let the transaction through', async () => {
            const overlay = confirming();

            expect(await serviceWith(overlay).judge(executed)).toMatchObject({ authorized: true });
            expect(overlay.confirm).toHaveBeenCalledWith({ txHash });
        });

        it('confirms a transaction whose trace captured no frame', async () => {
            const overlay = confirming();

            await serviceWith(overlay).judge({ ...executed, trace: { frame: null } });

            expect(overlay.checkTrace).not.toHaveBeenCalled();
            expect(overlay.confirm).toHaveBeenCalledWith({ txHash });
        });

        it('confirms nothing for a transaction an overlay refused', async () => {
            const overlay = confirming({ authorized: false, ruleId: 'policy.rule.block', reason: 'blocked' });

            await serviceWith(overlay).judge(executed);

            expect(overlay.confirm).not.toHaveBeenCalled();
        });

        it('confirms nothing short of an execution, nor without a transaction to name', async () => {
            const overlay = confirming();
            const service = serviceWith(overlay);

            await service.judge({ ...executed, moment: 'submission' });
            await service.judge({ ...executed, moment: 'simulation' });
            await service.judge({ ...write, moment: 'execution' });

            expect(overlay.confirm).not.toHaveBeenCalled();
        });

        it('takes a moment left unsaid as an execution, as an older sequencer sends it', async () => {
            const overlay = confirming();

            await serviceWith(overlay).judge({ ...write, txHash });

            expect(overlay.confirm).toHaveBeenCalledWith({ txHash });
        });

        it('refuses with the verdict an overlay raises while confirming', async () => {
            const lapsed: OverlayVerdict = { authorized: false, ruleId: 'policy.decision_required', reason: 'lapsed' };
            const overlay = { ...confirming(), confirm: vi.fn().mockRejectedValue(new OverlayRefusal(lapsed)) };

            expect(await serviceWith(overlay).judge(executed)).toMatchObject(lapsed);
        });

        it('fails closed as an outage when confirming throws', async () => {
            const overlay = { ...confirming(), confirm: vi.fn().mockRejectedValue(new Error('unreachable')) };

            expect(await serviceWith(overlay).judge(executed)).toMatchObject({
                authorized: false,
                ruleId: 'overlay.unavailable'
            });
        });
    });
});
