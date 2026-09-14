import { readFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import pino from 'pino';
import { pad, parseAbi } from 'viem';
import { describe, expect } from 'vitest';
import { TestExternalRpc } from '../../test/rpc/test-external-rpc';
import { it } from '../../test/unit-test-context';
import { type DB, Repositories } from '../db';
import { contractsTable, dbMutationAuditLogsTable } from '../db/schema';
import { AuthData } from '../middleware/auth-data';
import type { UserWithRoles } from '../repositories/users-repository';
import { eth_getLogs } from '../rpc/methods/handlers/eth_getLogs';
import { eth_getTransactionByHash } from '../rpc/methods/handlers/eth_getTransactionByHash';
import { eth_getTransactionReceipt } from '../rpc/methods/handlers/eth_getTransactionReceipt';
import { RpcAuthorizer } from '../rpc/permissions/rpc-authorizer';
import type { AuthorizedRpcContext } from '../rpc/rpc-service';
import { AuthorizationService } from './authorization-service';
import { EventPermissionVerifier, type EventReader } from './event-permission-verifier';

const messenger = pad('0x8008', { size: 20 });
const ordinary = pad('0x020000', { size: 20 });
const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const peerWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const abi = JSON.stringify(parseAbi(['function execute()', 'event Message(bytes32 indexed id)']));
const logger = pino({ level: 'silent' });
const migrationStatements = readFileSync(
    new URL('../../drizzle/0086_reject_reserved_org_contracts.sql', import.meta.url),
    'utf8'
).split('--> statement-breakpoint');

async function seedLegacyClaim(db: DB) {
    await db.execute(sql`ALTER TABLE contracts DROP CONSTRAINT chk_contracts_no_reserved_org_address`);
    const repos = new Repositories(db);
    const org = await repos.organizations.create({ name: 'Owner', defaultRoles: [] });
    const peerOrg = await repos.organizations.create({ name: 'Peer', defaultRoles: [] });
    const role = await repos.roles.create({
        roleName: 'Reader',
        organizationId: org.id,
        systemPermissions: ['rpc_read_eth_getLogs', 'full_read_access']
    });
    const peerRole = await repos.roles.create({
        roleName: 'Reader',
        organizationId: peerOrg.id,
        systemPermissions: ['rpc_read_eth_getLogs']
    });
    const user = await repos.users.create({
        displayName: 'Owner reader',
        source: 'adminPanel',
        organizationId: org.id,
        roles: [role.id],
        wallets: [wallet]
    });
    const peer = await repos.users.create({
        displayName: 'Peer reader',
        source: 'adminPanel',
        organizationId: peerOrg.id,
        roles: [peerRole.id],
        wallets: [peerWallet]
    });
    await repos.contracts.create({
        name: null,
        description: null,
        contractAddress: messenger,
        organizationId: org.id,
        abi,
        disclosureStartBlock: '0x0'
    });
    await repos.contractEventsPermissions.create({
        contractAddress: messenger,
        roles: [role, peerRole],
        organizationOnly: false
    });
    await repos.contractFunctionPermissions.create({
        contractAddress: messenger,
        functionSignature: 'function execute()',
        ruleType: 'public',
        accessType: 'write',
        organizationOnly: false
    });
    return { repos, org, user, peer, role };
}

function contextFor(repos: Repositories, user: UserWithRoles, multiOrgEnabled: boolean): AuthorizedRpcContext {
    const targetRpc = new TestExternalRpc();
    const auth = new AuthData({ user, targetType: 'user', expiresAt: new Date(), authMethod: 'session' });
    const authorizer = new RpcAuthorizer(
        auth,
        new AuthorizationService({ repos, multiOrgEnabled }),
        repos,
        new EventPermissionVerifier(repos, multiOrgEnabled),
        targetRpc,
        logger,
        'reserved-address-test'
    );
    const logs = [{ address: messenger, topics: [pad('0x01')], transactionHash: pad('0xab') }];
    targetRpc.registerSend('logs', logs);
    targetRpc.registerSend('transaction', { hash: pad('0xab'), from: peerWallet, to: ordinary, input: '0x12345678' });
    targetRpc.registerSend('transaction_receipt', {
        transactionHash: pad('0xab'),
        from: peerWallet,
        to: ordinary,
        logs
    });
    targetRpc.registerSend('receipt', {
        transactionHash: pad('0xab'),
        from: peerWallet,
        to: messenger,
        logs,
        logsBloom: '0x00'
    });
    return { authorizer, targetRpc, logger, bundlerRpc: null, deployment: null, policyEnabled: false };
}

describe('legacy reserved organization claims', () => {
    for (const multiOrgEnabled of [true, false]) {
        it(`revokes event grants and receipt visibility with multi-org=${multiOrgEnabled}`, async ({ db }) => {
            const { repos, user, peer, role, org } = await seedLegacyClaim(db);
            const verifier = new EventPermissionVerifier(repos, multiOrgEnabled);
            expect(await verifier.getRules(user.id)).toEqual([]);
            expect(await verifier.getRules(peer.id)).toEqual([]);
            expect(
                await verifier.checkMany(
                    { roleIds: [role.id], wallets: [wallet], organizationId: org.id },
                    [{ contractAddress: messenger }],
                    [messenger]
                )
            ).toEqual([false]);
            const ownContext = contextFor(repos, user, multiOrgEnabled);
            const peerContext = contextFor(repos, peer, multiOrgEnabled);
            for (const context of [ownContext, peerContext]) {
                expect(
                    await eth_getLogs.handle(context, 'eth_getLogs', [{ address: messenger }], 'logs')
                ).toMatchObject({
                    result: []
                });
            }
            expect(
                await eth_getTransactionReceipt.handle(
                    ownContext,
                    'eth_getTransactionReceipt',
                    [pad('0xab')],
                    'receipt'
                )
            ).toMatchObject({ result: null });
            expect(
                await eth_getTransactionByHash.handle(
                    ownContext,
                    'eth_getTransactionByHash',
                    [pad('0xab')],
                    'transaction'
                )
            ).toMatchObject({ result: null });
            expect(await ownContext.authorizer.hasOrgVisibilityOver(messenger)).toBe(false);
        });

        it(`ignores legacy function grants including umbrella coverage with multi-org=${multiOrgEnabled}`, async ({
            db
        }) => {
            const { repos, user } = await seedLegacyClaim(db);
            const service = new AuthorizationService({ repos, multiOrgEnabled });
            expect(
                await service.checkMethodAuthorizationForUser({
                    fromAddress: wallet,
                    user,
                    contractAddress: messenger,
                    calldata: '0x61461954',
                    accessTypeCheck: 'write'
                })
            ).toMatchObject({ authorized: false });
            for (const umbrellaCovered of [true, false]) {
                expect(
                    await service.checkUserAuthorizationForCalls({
                        fromAddress: wallet,
                        user,
                        calls: [{ contractAddress: messenger, calldata: '0x61461954', umbrellaCovered }],
                        accessTypeCheck: 'unenforced'
                    })
                ).toMatchObject([{ kind: 'result', result: { authorized: false } }]);
            }
        });
    }

    it('preserves explicit function grants and umbrella coverage for zone-owned interop built-ins', async ({ db }) => {
        const repos = new Repositories(db);
        const org = await repos.organizations.create({ name: 'Interop participant', defaultRoles: [] });
        const user = await repos.users.create({
            displayName: 'Interop caller',
            source: 'adminPanel',
            organizationId: org.id,
            wallets: [wallet],
            roles: []
        });
        const contractAddress = pad('0x10009', { size: 20 });
        await repos.contracts.create({
            name: null,
            description: null,
            contractAddress,
            organizationId: null,
            abi,
            disclosureStartBlock: '0x0'
        });
        await repos.contractFunctionPermissions.create({
            contractAddress,
            functionSignature: 'function execute()',
            ruleType: 'public',
            accessType: 'write'
        });
        for (const multiOrgEnabled of [true, false]) {
            const service = new AuthorizationService({ repos, multiOrgEnabled });
            expect(
                await service.checkMethodAuthorizationForUser({
                    fromAddress: wallet,
                    user,
                    contractAddress,
                    calldata: '0x61461954',
                    accessTypeCheck: 'write'
                })
            ).toMatchObject({ authorized: true });
            expect(
                await service.checkUserAuthorizationForCalls({
                    fromAddress: wallet,
                    user,
                    calls: [{ contractAddress, calldata: '0x61461954', umbrellaCovered: true }],
                    accessTypeCheck: 'unenforced'
                })
            ).toMatchObject([{ kind: 'result', result: { authorized: true } }]);
        }
    });

    it('deletes legacy claims and cascading grants, preserves zone contracts, and prevents new claims', async ({
        db
    }) => {
        const { repos, org, role } = await seedLegacyClaim(db);
        await repos.contracts.update(messenger, {
            ...(await repos.contracts.findByAddress(messenger)),
            abi: JSON.stringify(parseAbi(['function execute()', 'function send(address recipient)'])),
            disclosedAddresses: [{ address: wallet }]
        });
        await repos.contractFunctionPermissions.create({
            contractAddress: messenger,
            functionSignature: 'function send(address recipient)',
            ruleType: 'checkRoleAndRestrictArgument',
            accessType: 'write',
            roles: [role],
            argumentRestrictions: [{ argumentIndex: 0 }]
        });
        const zoneAddress = pad('0x10009', { size: 20 });
        for (const contractAddress of [zoneAddress, ordinary]) {
            await repos.contracts.create({
                name: null,
                description: null,
                contractAddress,
                organizationId: contractAddress === ordinary ? org.id : null,
                abi,
                disclosureStartBlock: '0x0'
            });
            await repos.contractEventsPermissions.create({ contractAddress, roles: [role] });
        }
        for (const value of ['0x8000', '0xffff', '0x10000', '0x1ffff'] as const) {
            await repos.contracts.create({
                name: null,
                description: null,
                contractAddress: pad(value, { size: 20 }),
                organizationId: org.id,
                abi,
                disclosureStartBlock: '0x0'
            });
        }
        await db.transaction(async (tx) => {
            for (const statement of migrationStatements) {
                await tx.execute(sql.raw(statement));
            }
        });
        const rows = await db.select().from(contractsTable);
        expect(rows.map((r) => r.contractAddress.toLowerCase()).sort()).toEqual([zoneAddress, ordinary].sort());
        expect(await repos.contractEventsPermissions.searchForRoles([role.id])).toHaveLength(2);
        expect(await db.query.contractFunctionPermissionsTable.findMany()).toEqual([]);
        const deletes = await db
            .select()
            .from(dbMutationAuditLogsTable)
            .where(
                and(
                    eq(dbMutationAuditLogsTable.tableName, 'contracts'),
                    eq(dbMutationAuditLogsTable.operation, 'DELETE')
                )
            );
        expect(deletes).toHaveLength(5);
        expect(
            deletes.every((row) => row.oldRow !== null && row.jobId === 'migration:reject_reserved_org_contracts')
        ).toBe(true);
        const cascadeDeletes = await db
            .select()
            .from(dbMutationAuditLogsTable)
            .where(
                and(
                    eq(dbMutationAuditLogsTable.operation, 'DELETE'),
                    eq(dbMutationAuditLogsTable.jobId, 'migration:reject_reserved_org_contracts')
                )
            );
        const counts = new Map<string, number>();
        for (const row of cascadeDeletes) {
            expect(row.oldRow).not.toBeNull();
            counts.set(row.tableName, (counts.get(row.tableName) ?? 0) + 1);
        }
        expect(Object.fromEntries(counts)).toEqual({
            contracts: 5,
            contract_function_permissions: 2,
            contract_function_permission_roles: 1,
            function_argument_restrictions: 1,
            contract_event_permissions: 1,
            contract_event_permissions_roles: 2,
            disclosed_addresses: 1
        });
        await expect(
            db
                .insert(contractsTable)
                .values({ contractAddress: messenger, organizationId: org.id, abi, disclosureStartBlock: '0x0' })
        ).rejects.toThrow();
        await expect(
            db
                .update(contractsTable)
                .set({ contractAddress: messenger })
                .where(eq(contractsTable.contractAddress, ordinary))
        ).rejects.toThrow();
        await expect(
            db
                .update(contractsTable)
                .set({ organizationId: org.id })
                .where(eq(contractsTable.contractAddress, zoneAddress))
        ).rejects.toThrow();
    });

    for (const initialTimeout of ['0', '500ms', '5s']) {
        it(`rolls back a blocked migration and restores lock_timeout=${initialTimeout} on retry`, async ({ db }) => {
            const { repos } = await seedLegacyClaim(db);
            const pool = new Pool({ ...db.$client.options, max: 3 });
            const [holder, migrator, reader] = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
            try {
                await holder.query('BEGIN');
                await holder.query('SELECT 1 FROM contracts');
                await migrator.query('SELECT set_config($1, $2, false)', ['lock_timeout', initialTimeout]);
                const backend = await migrator.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
                const pid = backend.rows[0]?.pid;
                expect(pid).toBeDefined();
                const migrate = async () => {
                    await migrator.query('BEGIN');
                    try {
                        for (const statement of migrationStatements) await migrator.query(statement);
                        const timeout = await migrator.query<{ lock_timeout: string }>('SHOW lock_timeout');
                        expect(timeout.rows[0]?.lock_timeout).toBe(initialTimeout);
                        await migrator.query('COMMIT');
                    } catch (error) {
                        await migrator.query('ROLLBACK');
                        throw error;
                    }
                };
                const start = performance.now();
                const blockedMigration = migrate().catch((error: unknown) => error);
                await expect
                    .poll(
                        async () => {
                            const locks = await db.execute(sql`
                        SELECT 1 FROM pg_locks
                        WHERE pid = ${pid} AND relation = 'contracts'::regclass
                          AND mode = 'AccessExclusiveLock' AND NOT granted
                    `);
                            return locks.rowCount;
                        },
                        { interval: 10, timeout: 400 }
                    )
                    .toBe(1);
                const queuedRead = reader.query('SELECT count(*)::int AS count FROM contracts');
                expect(await blockedMigration).toMatchObject({ code: '55P03' });
                expect(performance.now() - start).toBeLessThan(initialTimeout === '500ms' ? 2000 : 5000);
                expect((await queuedRead).rows[0]?.count).toBe(1);
                expect(await repos.contracts.findByAddress(messenger)).toBeDefined();
                expect(await db.query.contractFunctionPermissionsTable.findMany()).toHaveLength(1);
                expect(await db.query.contractEventPermissionsTable.findMany()).toHaveLength(1);
                expect(
                    await db.query.dbMutationAuditLogsTable.findMany({
                        where: eq(dbMutationAuditLogsTable.jobId, 'migration:reject_reserved_org_contracts')
                    })
                ).toEqual([]);
                await holder.query('ROLLBACK');
                await migrate();
                const constraint = await reader.query<{ convalidated: boolean }>(
                    "SELECT convalidated FROM pg_constraint WHERE conrelid = 'contracts'::regclass AND conname = 'chk_contracts_no_reserved_org_address'"
                );
                expect(constraint.rows).toEqual([{ convalidated: true }]);
                expect((await reader.query('SELECT count(*)::int AS count FROM contracts')).rows[0]?.count).toBe(0);
                expect((await migrator.query('SHOW lock_timeout')).rows[0]?.lock_timeout).toBe(initialTimeout);
            } finally {
                await holder.query('ROLLBACK');
                await migrator.query('ROLLBACK');
                holder.release();
                migrator.release();
                reader.release();
                await pool.end();
            }
        }, 15_000);
    }

    it('requires explicit event permissions for reserved zone contracts while preserving ordinary org visibility', async ({
        db
    }) => {
        const repos = new Repositories(db);
        const role = await repos.roles.create({ roleName: 'Reader', systemPermissions: [] });
        await repos.contracts.create({
            name: null,
            description: null,
            contractAddress: messenger,
            abi,
            disclosureStartBlock: '0x0'
        });
        const verifier = new EventPermissionVerifier(repos, true);
        const reader: EventReader = { roleIds: [role.id], wallets: [wallet], organizationId: null };
        expect(
            await verifier.checkMany(
                reader,
                [{ contractAddress: messenger }, { contractAddress: ordinary }],
                [ordinary]
            )
        ).toEqual([false, true]);
        await repos.contractEventsPermissions.create({
            contractAddress: messenger,
            roles: [role],
            topic1ConditionType: 'userAddress'
        });
        expect(
            await verifier.checkMany(reader, [
                { contractAddress: messenger, topic1: pad(wallet) },
                { contractAddress: messenger, topic1: pad(peerWallet) }
            ])
        ).toEqual([true, false]);
    });
});
