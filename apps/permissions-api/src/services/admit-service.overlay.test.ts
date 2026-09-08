import { type AuthorizationOverlay, OverlayRefusal, type OverlayVerdict } from '@repo/api-kit';
import { pad } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { Repositories } from '../db';
import { AdmitService } from './admit-service';
import type { AuthorizationService } from './authorization-service';
import type { TransactionClassifier } from './transaction-classifier';

/**
 * The two properties the overlay seam exists for: it can only narrow the core's decision,
 * and an overlay that cannot answer denies. Both are load-bearing and neither is observable
 * from the feature side, so they are pinned here rather than in the private feature's suite.
 */
describe('AdmitService — the overlay seam', () => {
    const PROTOCOL_VERSION = '1';
    const from = pad('0x01', { size: 20 });
    const to = pad('0x02', { size: 20 });

    /** A native transfer to an EOA: the shortest path to a capability allow. */
    const write = {
        protocolVersion: PROTOCOL_VERSION,
        from,
        to,
        value: 1n,
        calldata: '0x' as const,
        gasLimit: 21_000,
        accessType: 'write' as const
    };

    function serviceWithAll(overlays: AuthorizationOverlay[], protocolVersions = [PROTOCOL_VERSION]) {
        const repos = {
            users: {
                findByAddressWithRoles: vi.fn().mockResolvedValue({ organizationId: null, organization: null })
            }
        } as unknown as Repositories;

        return new AdmitService({
            repos,
            authorizationService: {} as AuthorizationService,
            transactionClassifier: {
                classifyTransaction: vi.fn().mockResolvedValue({ type: 'transfer-to-eoa' })
            } as unknown as TransactionClassifier,
            logger: { error: vi.fn() },
            protocolVersions,
            ...(overlays.length === 0 ? {} : { overlays })
        });
    }

    const serviceWith = (overlay?: AuthorizationOverlay, protocolVersions = [PROTOCOL_VERSION]) =>
        serviceWithAll(overlay === undefined ? [] : [overlay], protocolVersions);

    const overlayReturning = (verdict: OverlayVerdict | undefined) => ({
        check: vi.fn().mockResolvedValue(verdict),
        checkTrace: vi.fn()
    });

    it('admits what the core admits when no overlay is registered', async () => {
        expect(await serviceWith().admit(write)).toMatchObject({ authorized: true });
    });

    it('lets an overlay narrow an allow into a denial', async () => {
        const overlay = overlayReturning({ authorized: false, ruleId: 'policy.rule.block', reason: 'blocked' });

        expect(await serviceWith(overlay).admit(write)).toMatchObject({
            authorized: false,
            ruleId: 'policy.rule.block'
        });
    });

    it('never lets an overlay widen a denial, and does not consult it', async () => {
        const overlay = overlayReturning({ authorized: true, ruleId: 'policy.rule.allow' });
        // Refused on protocol version, so the core has already said no.
        const service = serviceWith(overlay, ['99']);

        const result = await service.admit(write);

        expect(result.authorized).toBe(false);
        expect(result.ruleId).toBe('protocol.version_mismatch');
        expect(overlay.check).not.toHaveBeenCalled();
    });

    it('returns the capability result unchanged when the overlay allows', async () => {
        const overlay = overlayReturning({ authorized: true, ruleId: 'policy.rule.allow' });

        // `isUmbrella` rides on the capability result, so the overlay's allow must not
        // replace it.
        expect(await serviceWith(overlay).admit(write)).toMatchObject({
            authorized: true,
            ruleId: 'transfer.native.allow'
        });
    });

    it('fails closed when the overlay throws, suppressing the capability allow', async () => {
        const overlay = { check: vi.fn().mockRejectedValue(new Error('boom')), checkTrace: vi.fn() };

        const result = await serviceWith(overlay).admit(write);

        expect(result).toMatchObject({ authorized: false, ruleId: 'overlay.unavailable' });
        // The thrown message would disclose registry and ABI state to the submitter.
        expect(result.reason).not.toContain('boom');
    });

    it('stops at the first overlay that denies, so none of them can widen another', async () => {
        const deny = overlayReturning({ authorized: false, ruleId: 'policy.rule.block', reason: 'blocked' });
        const allow = overlayReturning({ authorized: true, ruleId: 'policy.rule.allow' });

        const result = await serviceWithAll([deny, allow]).admit(write);

        expect(result).toMatchObject({ authorized: false, ruleId: 'policy.rule.block' });
        // The conjunction is what makes several features composable: a later allow must
        // never be able to reverse an earlier denial, so it is not even consulted.
        expect(allow.check).not.toHaveBeenCalled();
    });

    it('consults every overlay while they allow', async () => {
        const first = overlayReturning({ authorized: true, ruleId: 'policy.rule.allow' });
        const second = overlayReturning(undefined);

        expect(await serviceWithAll([first, second]).admit(write)).toMatchObject({ authorized: true });
        expect(first.check).toHaveBeenCalled();
        expect(second.check).toHaveBeenCalled();
    });

    it('reports a raised verdict as that verdict rather than an outage', async () => {
        const overlay = {
            check: vi
                .fn()
                .mockRejectedValue(
                    new OverlayRefusal(
                        { authorized: false, ruleId: 'policy.frame.unclassifiable', reason: 'cannot classify' },
                        'undecodable calldata'
                    )
                ),
            checkTrace: vi.fn()
        };

        expect(await serviceWith(overlay).admit(write)).toMatchObject({
            authorized: false,
            ruleId: 'policy.frame.unclassifiable'
        });
    });

    it('leaves a read to the core, so preparing a transaction is not refused by policy', async () => {
        const overlay = overlayReturning({ authorized: false, ruleId: 'policy.rule.block' });

        const result = await serviceWith(overlay).admit({ ...write, accessType: 'read' });

        expect(result).toMatchObject({ authorized: true });
        expect(overlay.check).not.toHaveBeenCalled();
    });
});
