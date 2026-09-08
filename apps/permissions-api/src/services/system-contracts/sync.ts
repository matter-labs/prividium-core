import { isDeepStrictEqual } from 'node:util';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { DbOrTx } from '../../db';
import { contractsTable } from '../../db/schema';
import type { PinoLogger } from '../../utils/logger';
import { SYSTEM_CONTRACTS_REGISTRY, type SystemContractDefinition } from './registry';

/**
 * Strict-syncs the hardcoded system contracts registry into the database.
 *
 * Algorithm (runs inside a single transaction):
 *   1. For each registry entry → insert or update the contract row only if sync-owned fields changed.
 *   2. Delete any DB rows where `isSystemContract=true` but address is absent from the registry.
 *
 * DB mutations are captured automatically by Postgres audit triggers.
 *
 * Any error causes the transaction to roll back, and the thrown error is
 * expected to be caught by the bootstrap code which will `process.exit(1)`.
 */
export async function syncSystemContracts(db: DbOrTx, logger: PinoLogger): Promise<void> {
    const log = logger.child({ role: 'system-contracts-sync' });
    const registryAddresses = SYSTEM_CONTRACTS_REGISTRY.map((c) => c.contractAddress);

    await db.repositories().transaction(async (tx) => {
        // Fetch all existing contracts that overlap with the registry in one query
        const existingContracts =
            registryAddresses.length > 0
                ? await tx.query.contractsTable.findMany({
                      where: inArray(contractsTable.contractAddress, registryAddresses)
                  })
                : [];
        const existingByAddress = new Map(existingContracts.map((c) => [c.contractAddress, c]));

        // Sync each registry contract
        for (const def of SYSTEM_CONTRACTS_REGISTRY) {
            const existing = existingByAddress.get(def.contractAddress);
            const current = existing ? dbRowToSystemContractDef(existing) : null;
            const diff = diffSystemContract(current, def);

            if (diff === 'noop') {
                continue;
            }

            if (diff === 'create') {
                await tx.insert(contractsTable).values(def);
                continue;
            }

            if (diff === 'update') {
                await tx.update(contractsTable).set(def).where(eq(contractsTable.contractAddress, def.contractAddress));
                continue;
            }

            diff satisfies never;
        }

        // Delete stale system contracts (marked as system but no longer in registry)
        const staleWhere =
            registryAddresses.length > 0
                ? and(
                      eq(contractsTable.isSystemContract, true),
                      notInArray(contractsTable.contractAddress, registryAddresses)
                  )
                : eq(contractsTable.isSystemContract, true);
        const staleContracts = await tx.query.contractsTable.findMany({ where: staleWhere });

        for (const stale of staleContracts) {
            await tx.delete(contractsTable).where(eq(contractsTable.contractAddress, stale.contractAddress));
            log.info(`Deleted stale system contract ${stale.contractAddress}`);
        }
    });

    log.info(`System contracts sync complete (${SYSTEM_CONTRACTS_REGISTRY.length} registry entries)`);
}

function dbRowToSystemContractDef(row: typeof contractsTable.$inferSelect): SystemContractDefinition {
    const { createdAt, updatedAt, ...rest } = row;
    return rest;
}

function diffSystemContract(
    existing: SystemContractDefinition | null,
    next: SystemContractDefinition
): 'create' | 'noop' | 'update' {
    if (existing === null) {
        return 'create';
    }

    if (isDeepStrictEqual(existing, next)) {
        return 'noop';
    }

    return 'update';
}
