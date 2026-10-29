import { eq } from 'drizzle-orm';
import pino from 'pino';
import { describe, expect, vi } from 'vitest';
import { ZKSYNC_SYSTEM_CONTRACTS } from '#chains/evm/system-contracts';
import { chainRegistry } from '#chains/index';
import { Repositories } from '#db/index';
import { contractFunctionPermissionsTable, contractsTable } from '#db/schema';
import { it } from '#test/unit-test-context';
import { prepareDatabase } from './prepare-database';
import { syncSystemContracts } from './system-contracts/sync';

const logger = pino({ level: 'silent' });

// A chain type exists only once a module declares it; a bare ref stands in for a private chain module.
const chains = chainRegistry([
    { id: 'other-chain', chainTypes: ['other-chain'], load: () => Promise.reject(new Error('unused')) }
]);
const ZKSYNC_OS = chains.parse('zksync-os');
const OTHER_CHAIN = chains.parse('other-chain');

describe('prepareDatabase', () => {
    it('refuses a database stamped for another chain type before it migrates or writes', async ({ db }) => {
        await new Repositories(db).deploymentIdentity.insertIfAbsent(ZKSYNC_OS);
        await syncSystemContracts(db, logger, ZKSYNC_SYSTEM_CONTRACTS);
        await db.insert(contractFunctionPermissionsTable).values({
            contractAddress: ZKSYNC_SYSTEM_CONTRACTS[0]!.address,
            methodSelector: '0x12345678',
            accessType: 'read',
            functionSignature: 'function test() view returns (uint256)',
            ruleType: 'public'
        });
        const migrate = vi.fn();

        await expect(
            prepareDatabase(db, OTHER_CHAIN, {
                migrate,
                startup: (scopedDb) => syncSystemContracts(scopedDb, logger, [])
            })
        ).rejects.toThrow("The database serves 'zksync-os'; this deployment is configured for 'other-chain'");

        expect(migrate).not.toHaveBeenCalled();
        const systemContracts = await db.query.contractsTable.findMany({
            where: eq(contractsTable.isSystemContract, true)
        });
        expect(systemContracts).toHaveLength(ZKSYNC_SYSTEM_CONTRACTS.length);
        expect(await db.query.contractFunctionPermissionsTable.findMany()).toHaveLength(1);
    });

    it('migrates, then stamps a fresh database, then runs the startup mutations', async ({ db }) => {
        const steps: string[] = [];

        await prepareDatabase(db, ZKSYNC_OS, {
            migrate: async () => {
                steps.push('migrate');
            },
            startup: async (scopedDb) => {
                steps.push(`startup, stamped ${await scopedDb.repositories().deploymentIdentity.find()}`);
            }
        });

        expect(steps).toEqual(['migrate', 'startup, stamped zksync-os']);
    });
});
