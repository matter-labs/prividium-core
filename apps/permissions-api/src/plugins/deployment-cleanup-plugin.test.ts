import { subHours } from 'date-fns';
import { pino } from 'pino';
import type { Address, Hex } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { UserSources } from '../db/schema';
import { type SweepDeps, sweepStalePendingDeployments } from './deployment-cleanup-plugin';

const DEPLOYER = '0x1234567890123456789012345678901234567890' as Address;
const CONTRACT = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
const TX_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;

describe('sweepStalePendingDeployments', () => {
    let repos: Repositories;

    beforeEach<Fixture>(async ({ db }) => {
        repos = new Repositories(db);
        await repos.users.create({
            oidcSub: 'deployer-user',
            displayName: 'Deployer User',
            wallets: [DEPLOYER],
            source: UserSources.enum.adminPanel
        });
    });

    function chainRpcWith(overrides: Partial<SweepDeps['chainRpc']> = {}): SweepDeps['chainRpc'] {
        return {
            deployReceiptContractAddress: async () => null,
            transactionIsKnown: async () => false,
            ...overrides
        };
    }

    async function createStalePending(overrides: { deployerNonce?: number } = {}) {
        const nonce = overrides.deployerNonce ?? 1;
        return repos.contractDeployments.create({
            address: CONTRACT,
            deployerAddress: DEPLOYER,
            deployerNonce: nonce,
            deployTxHash: `${TX_HASH.slice(0, -1)}${nonce}` as Hex,
            startedAt: subHours(new Date(), 2)
        });
    }

    const deps = (chainRpc: SweepDeps['chainRpc']): SweepDeps => ({
        repos,
        chainRpc,
        logger: pino({ level: 'silent' })
    });

    it('promotes a stale row whose tx mined at the predicted address', async () => {
        const row = await createStalePending();
        const chainRpc = chainRpcWith({ deployReceiptContractAddress: async () => CONTRACT });

        const outcome = await sweepStalePendingDeployments(deps(chainRpc), new Date());

        expect(outcome).toEqual({ promoted: 1, errored: 0, skipped: 0 });
        const promoted = await repos.contractDeployments.findByAddress(CONTRACT);
        expect(promoted?.id).toBe(row.id);
        expect(promoted?.successAt).not.toBeNull();
    });

    it('errors a dropped tx, removing it from authorship lookups', async () => {
        const row = await createStalePending();

        const outcome = await sweepStalePendingDeployments(deps(chainRpcWith()), new Date());

        expect(outcome).toEqual({ promoted: 0, errored: 1, skipped: 0 });
        expect(await repos.contractDeployments.findByAddress(CONTRACT)).toBeUndefined();
        expect(await repos.contractDeployments.findAllPendingByAddress(CONTRACT)).toEqual([]);
        await expect(repos.contractDeployments.success(row.id)).rejects.toThrow(
            'Cannot mark an errored deployment as successful.'
        );
    });

    it('keeps a row whose tx the node still knows (unmined but not dropped)', async () => {
        await createStalePending();
        const chainRpc = chainRpcWith({ transactionIsKnown: async () => true });

        const outcome = await sweepStalePendingDeployments(deps(chainRpc), new Date());

        expect(outcome).toEqual({ promoted: 0, errored: 0, skipped: 1 });
        expect(await repos.contractDeployments.findAllPendingByAddress(CONTRACT)).toHaveLength(1);
    });

    it('errors a stale row whose receipt deployed a different address', async () => {
        await createStalePending();
        const other = '0x9999999999999999999999999999999999999999' as Address;
        const chainRpc = chainRpcWith({ deployReceiptContractAddress: async () => other });

        const outcome = await sweepStalePendingDeployments(deps(chainRpc), new Date());

        expect(outcome).toEqual({ promoted: 0, errored: 1, skipped: 0 });
    });

    it('keeps rows pending and aborts the tick when the upstream keeps failing', async () => {
        for (let nonce = 1; nonce <= 4; nonce++) {
            await createStalePending({ deployerNonce: nonce });
        }
        const chainRpc = chainRpcWith({
            deployReceiptContractAddress: async () => {
                throw new Error('upstream down');
            }
        });

        const outcome = await sweepStalePendingDeployments(deps(chainRpc), new Date());

        // Aborts after 3 consecutive failures; the 4th row is not attempted.
        expect(outcome).toEqual({ promoted: 0, errored: 0, skipped: 3 });
        expect(await repos.contractDeployments.findAllPendingByAddress(CONTRACT)).toHaveLength(4);
    });

    it('leaves rows newer than the cutoff and already-resolved rows alone', async () => {
        const fresh = await repos.contractDeployments.create({
            address: CONTRACT,
            deployerAddress: DEPLOYER,
            deployerNonce: 1,
            deployTxHash: TX_HASH,
            startedAt: new Date()
        });
        const resolved = await repos.contractDeployments.create({
            address: '0x2222222222222222222222222222222222222222' as Address,
            deployerAddress: DEPLOYER,
            deployerNonce: 2,
            deployTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex,
            startedAt: subHours(new Date(), 2)
        });
        await repos.contractDeployments.success(resolved.id);

        const outcome = await sweepStalePendingDeployments(deps(chainRpcWith()), subHours(new Date(), 1));

        expect(outcome).toEqual({ promoted: 0, errored: 0, skipped: 0 });
        const stillPending = await repos.contractDeployments.findAllPendingByAddress(CONTRACT);
        expect(stillPending).toHaveLength(1);
        expect(stillPending[0]?.id).toBe(fresh.id);
    });
});
