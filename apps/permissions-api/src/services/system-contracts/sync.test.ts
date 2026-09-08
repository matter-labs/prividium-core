import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../../test/unit-test-context';
import type { DB } from '../../db';
import { Repositories } from '../../db';

import { contractFunctionPermissionsTable, contractsTable, dbMutationAuditLogsTable } from '../../db/schema';
import { SYSTEM_CONTRACTS_REGISTRY } from './registry';
import { syncSystemContracts } from './sync';

const logger = pino({ level: 'silent' });

describe('syncSystemContracts', () => {
    const registryEntry = SYSTEM_CONTRACTS_REGISTRY[0]!;
    const registryAddress = registryEntry.contractAddress;

    beforeEach<Fixture>(async ({ db }) => {
        new Repositories(db);
    });

    it('inserts missing system contracts', async ({ db }) => {
        await syncSystemContracts(db, logger);

        const row = await db.query.contractsTable.findFirst({
            where: eq(contractsTable.contractAddress, registryAddress)
        });
        expect(row).toBeDefined();
        expect(row!.isSystemContract).toBe(true);
        expect(row!.name).toBe(registryEntry.name);
        expect(row!.abi).toBe(registryEntry.abi);
        expect(row!.templateId).toBeNull();

        const logs = await findSyncMutations(db, registryAddress);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            operation: 'INSERT',
            tableName: 'contracts',
            oldRow: null,
            newRow: expect.objectContaining({ name: registryEntry.name })
        });
    });

    it('overwrites conflicting existing contract at same address', async ({ db }) => {
        // Pre-insert a regular contract at the same address with different metadata
        await db.insert(contractsTable).values({
            contractAddress: registryAddress,
            abi: '[]',
            name: 'OldName',
            description: 'Old description',
            discloseErc20TotalSupply: true,
            discloseBytecode: true,
            isSystemContract: false,
            disclosureStartBlock: '0x0'
        });

        await syncSystemContracts(db, logger);

        const row = await db.query.contractsTable.findFirst({
            where: eq(contractsTable.contractAddress, registryAddress)
        });
        expect(row!.isSystemContract).toBe(true);
        expect(row!.name).toBe(registryEntry.name);
        expect(row!.abi).toBe(registryEntry.abi);
        expect(row!.discloseErc20TotalSupply).toBe(registryEntry.discloseErc20TotalSupply);
        expect(row!.discloseBytecode).toBe(registryEntry.discloseBytecode);

        const logs = await findSyncMutations(db, registryAddress, 'UPDATE');
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            operation: 'UPDATE',
            tableName: 'contracts'
        });

        const oldRow = logs[0]!.oldRow as Record<string, unknown>;
        const newRow = logs[0]!.newRow as Record<string, unknown>;
        expect(oldRow).toMatchObject({
            abi: '[]',
            name: 'OldName',
            description: 'Old description',
            disclose_erc20_total_supply: true,
            disclose_bytecode: true,
            is_system_contract: false
        });
        expect(newRow).toMatchObject({
            abi: registryEntry.abi,
            name: registryEntry.name,
            description: registryEntry.description,
            disclose_erc20_total_supply: registryEntry.discloseErc20TotalSupply,
            disclose_bytecode: registryEntry.discloseBytecode,
            is_system_contract: true
        });
    });

    it('preserves existing function permissions', async ({ db }) => {
        // Pre-insert the contract
        await db.insert(contractsTable).values({
            contractAddress: registryAddress,
            abi: registryEntry.abi,
            name: registryEntry.name,
            description: registryEntry.description,
            discloseErc20TotalSupply: registryEntry.discloseErc20TotalSupply,
            discloseBytecode: registryEntry.discloseBytecode,
            isSystemContract: true,
            disclosureStartBlock: '0x0'
        });

        // Add a function permission
        await db.insert(contractFunctionPermissionsTable).values({
            contractAddress: registryAddress,
            methodSelector: '0x12345678',
            accessType: 'read',
            functionSignature: 'function test() view returns (uint256)',
            ruleType: 'public'
        });

        await syncSystemContracts(db, logger);

        // Permission should still exist
        const permissions = await db.query.contractFunctionPermissionsTable.findMany({
            where: eq(contractFunctionPermissionsTable.contractAddress, registryAddress)
        });
        expect(permissions).toHaveLength(1);
        expect(permissions[0]!.methodSelector).toBe('0x12345678');

        // No UPDATE or DELETE should occur — sync is a no-op for unchanged contracts
        const updateLogs = await findSyncMutations(db, registryAddress, 'UPDATE');
        const deleteLogs = await findSyncMutations(db, registryAddress, 'DELETE');
        expect(updateLogs).toHaveLength(0);
        expect(deleteLogs).toHaveLength(0);
    });

    it('forces templateId=null', async ({ db }) => {
        // Even if someone set a templateId, sync should reset it to null
        // (We can't set a foreign key here without a real template, but we can verify
        // the sync output always has templateId=null)
        await syncSystemContracts(db, logger);

        const row = await db.query.contractsTable.findFirst({
            where: eq(contractsTable.contractAddress, registryAddress)
        });
        expect(row!.templateId).toBeNull();
    });

    it('removes stale system contracts after registry removal', async ({ db }) => {
        const staleAddress = '0x0000000000000000000000000000000000099999';

        // Insert a stale system contract (marked as system but not in registry)
        await db.insert(contractsTable).values({
            contractAddress: staleAddress,
            abi: '[]',
            name: 'StaleContract',
            description: null,
            isSystemContract: true,
            disclosureStartBlock: '0x0'
        });

        await syncSystemContracts(db, logger);

        // Stale system contract should be deleted
        const staleRow = await db.query.contractsTable.findFirst({
            where: eq(contractsTable.contractAddress, staleAddress)
        });
        expect(staleRow).toBeUndefined();

        const logs = await findSyncMutations(db, staleAddress, 'DELETE');
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            operation: 'DELETE',
            tableName: 'contracts',
            newRow: null,
            oldRow: expect.objectContaining({
                abi: '[]',
                name: 'StaleContract',
                description: null,
                is_system_contract: true
            })
        });

        // Registry contract should still exist
        const registryRow = await db.query.contractsTable.findFirst({
            where: eq(contractsTable.contractAddress, registryAddress)
        });
        expect(registryRow).toBeDefined();
    });

    it('does not remove non-system contracts', async ({ db }) => {
        const regularAddress = '0x0000000000000000000000000000000000088888';

        // Insert a regular contract (not marked as system)
        await db.insert(contractsTable).values({
            contractAddress: regularAddress,
            abi: '[]',
            name: 'RegularContract',
            description: null,
            isSystemContract: false,
            disclosureStartBlock: '0x0'
        });

        await syncSystemContracts(db, logger);

        // Regular contract should still exist
        const regularRow = await db.query.contractsTable.findFirst({
            where: eq(contractsTable.contractAddress, regularAddress)
        });
        expect(regularRow).toBeDefined();
        expect(regularRow!.isSystemContract).toBe(false);
    });

    it('is idempotent', async ({ db }) => {
        await syncSystemContracts(db, logger);
        await syncSystemContracts(db, logger);

        const rows = await db.query.contractsTable.findMany({
            where: eq(contractsTable.isSystemContract, true)
        });
        expect(rows).toHaveLength(SYSTEM_CONTRACTS_REGISTRY.length);

        const logs = await findSyncMutations(db, registryAddress);
        expect(logs).toHaveLength(1);
        expect(logs[0]!.operation).toBe('INSERT');
    });

    async function findSyncMutations(db: DB, contractAddress: string, operation?: 'INSERT' | 'UPDATE' | 'DELETE') {
        // contract_address is stored as bytea; jsonb encodes it as '\x<hex-without-0x>'
        const byteaHex = `\\x${contractAddress.slice(2).toLowerCase()}`;
        const conditions = [
            eq(dbMutationAuditLogsTable.tableName, 'contracts'),
            sql`COALESCE(new_row->>'contract_address', old_row->>'contract_address') = ${byteaHex}`
        ];
        if (operation) {
            conditions.push(eq(dbMutationAuditLogsTable.operation, operation));
        }
        return db
            .select()
            .from(dbMutationAuditLogsTable)
            .where(and(...conditions))
            .orderBy(dbMutationAuditLogsTable.occurredAt);
    }
});
