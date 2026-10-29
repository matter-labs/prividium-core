import { isDeepStrictEqual } from 'node:util';
import { type SystemContract, selectedChain } from '@repo/api-kit';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { DbOrTx } from '#db/index';
import { contractsTable } from '#db/schema';
import type { PinoLogger } from '#utils/logger';

type SystemContractRow = Omit<typeof contractsTable.$inferSelect, 'createdAt' | 'updatedAt'>;

/** Strict-syncs the chain's system contracts: rows are inserted, updated or, once dropped from the list, deleted. */
export async function syncSystemContracts(
    db: DbOrTx,
    logger: PinoLogger,
    systemContracts: readonly SystemContract[]
): Promise<void> {
    const log = logger.child({ role: 'system-contracts-sync' });
    if (systemContracts.length === 0) {
        // A stamped database never holds another chain's system contracts, so none is stale; skipping keeps a
        // misconfigured first boot, before the stamp, from deleting them.
        log.info('System contracts sync skipped: the chain declares none');
        return;
    }
    const rows = systemContracts.map(toRow);
    const addresses = rows.map((row) => row.contractAddress);

    await db.repositories().transaction(async (tx) => {
        const existingContracts = await tx.query.contractsTable.findMany({
            where: inArray(contractsTable.contractAddress, addresses)
        });
        const existingByAddress = new Map(existingContracts.map((c) => [c.contractAddress, c]));

        for (const row of rows) {
            const existing = existingByAddress.get(row.contractAddress);
            const current = existing ? withoutTimestamps(existing) : null;
            const diff = diffSystemContract(current, row);

            if (diff === 'noop') {
                continue;
            }

            if (diff === 'create') {
                await tx.insert(contractsTable).values(row);
                continue;
            }

            if (diff === 'update') {
                await tx.update(contractsTable).set(row).where(eq(contractsTable.contractAddress, row.contractAddress));
                continue;
            }

            diff satisfies never;
        }

        const staleContracts = await tx.query.contractsTable.findMany({
            where: and(eq(contractsTable.isSystemContract, true), notInArray(contractsTable.contractAddress, addresses))
        });

        for (const stale of staleContracts) {
            await tx.delete(contractsTable).where(eq(contractsTable.contractAddress, stale.contractAddress));
            log.info(`Deleted stale system contract ${stale.contractAddress}`);
        }
    });

    log.info(`System contracts sync complete (${rows.length} registry entries)`);
}

function toRow(contract: SystemContract): SystemContractRow {
    const { address, ...rest } = contract;
    return {
        ...rest,
        // Canonical, as rows read back, so a module's own spelling still matches them.
        contractAddress: selectedChain().addresses.schema.parse(address),
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    };
}

function withoutTimestamps(row: typeof contractsTable.$inferSelect): SystemContractRow {
    const { createdAt, updatedAt, ...rest } = row;
    return rest;
}

function diffSystemContract(existing: SystemContractRow | null, next: SystemContractRow): 'create' | 'noop' | 'update' {
    if (existing === null) {
        return 'create';
    }

    if (isDeepStrictEqual(existing, next)) {
        return 'noop';
    }

    return 'update';
}
