import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import type { Address } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import {
    contractFunctionPermissionsTable,
    contractsTable,
    organizationsTable,
    rolesTable,
    servicesTable
} from '../db/schema';
import { EntityNotFound, InvalidEntity, InvalidInputError } from '../utils/error-types';
import { EntityRepository } from './entity-repository';

// --- Instantiations: one per primary-key shape in the schema -----------------

/** nanoid string primary key. */
class TestServicesRepository extends EntityRepository({
    table: servicesTable,
    idColumn: servicesTable.id,
    entityName: 'Service',
    defaultOrderBy: [asc(servicesTable.createdAt), asc(servicesTable.id)]
}) {
    async findByPublicKey(publicKey: Address, filter?: SQL) {
        return this.findOne({ filter: and(eq(servicesTable.publicKey, publicKey), filter) });
    }

    async getByPublicKey(publicKey: Address, filter?: SQL) {
        return this.getOne({ filter: and(eq(servicesTable.publicKey, publicKey), filter) });
    }

    async findAll(orderBy?: SQL[]) {
        return this.findMany({ orderBy });
    }

    async findAllByName(name: string, orderBy?: SQL[]) {
        return this.findMany({ filter: eq(servicesTable.name, name), orderBy });
    }

    async updateWhere(data: Partial<typeof servicesTable.$inferInsert>, filter?: SQL) {
        return this.update(data, { filter });
    }

    async deleteWhere(filter?: SQL) {
        return this.delete({ filter });
    }
}

/** bytea address primary key (custom column type). */
class TestContractsRepository extends EntityRepository({
    table: contractsTable,
    idColumn: contractsTable.contractAddress,
    entityName: 'Contract',
    defaultOrderBy: [asc(contractsTable.contractAddress)]
}) {}

/** integer identity primary key. */
class TestFunctionPermissionsRepository extends EntityRepository({
    table: contractFunctionPermissionsTable,
    idColumn: contractFunctionPermissionsTable.id,
    entityName: 'Permission',
    defaultOrderBy: [asc(contractFunctionPermissionsTable.id)]
}) {}

/** Natural text primary key + method override delegating to super. */
const TestRolesBase = EntityRepository({
    table: rolesTable,
    idColumn: rolesTable.roleName,
    entityName: 'Role',
    defaultOrderBy: [asc(rolesTable.roleName)]
});

class TestRolesRepository extends TestRolesBase {
    override async updateById(roleName: string, data: Partial<typeof rolesTable.$inferInsert>) {
        const existing = await this.findById(roleName);
        if (existing?.isSystemRole) {
            throw new InvalidEntity('system roles cannot be updated');
        }
        return super.updateById(roleName, data);
    }
}

/** Soft-delete table: baseFilter applied to every read/update/delete. */
class TestOrganizationsRepository extends EntityRepository({
    table: organizationsTable,
    idColumn: organizationsTable.id,
    entityName: 'Organization',
    defaultOrderBy: [asc(organizationsTable.createdAt), asc(organizationsTable.id)],
    baseFilter: isNull(organizationsTable.deletedAt)
}) {
    async findByName(name: string) {
        return this.findOne({ filter: eq(organizationsTable.name, name) });
    }

    async getByName(name: string) {
        return this.getOne({ filter: eq(organizationsTable.name, name) });
    }

    async findAll() {
        return this.findMany();
    }
}

const randomAddress = () => privateKeyToAddress(generatePrivateKey());

describe('EntityRepository', () => {
    describe('verb convention (nanoid string primary key)', () => {
        let repository: TestServicesRepository;

        beforeEach<Fixture>(({ db }) => {
            repository = new TestServicesRepository(db);
        });

        it('create returns the created entity', async () => {
            const service = await repository.create({ name: 'Svc', publicKey: randomAddress() });

            expect(service.id).toHaveLength(21);
            expect(service.name).toEqual('Svc');
            expect(service.createdAt).toBeInstanceOf(Date);
        });

        it('findById returns undefined when nothing matches', async () => {
            expect(await repository.findById('missing')).toBeUndefined();
        });

        it('findById returns the entity when present', async () => {
            const created = await repository.create({ name: 'Svc', publicKey: randomAddress() });
            expect(await repository.findById(created.id)).toEqual(created);
        });

        it('getById throws EntityNotFound when nothing matches', async () => {
            const error = await repository.getById('missing').catch((e) => e);

            expect(error).toBeInstanceOf(EntityNotFound);
            expect(error.statusCode).toEqual(404);
            expect(error.code).toEqual('NOT_FOUND');
            expect(error.message).toEqual('Service with id "missing" not found');
        });

        it('getById returns the entity when present', async () => {
            const created = await repository.create({ name: 'Svc', publicKey: randomAddress() });
            expect(await repository.getById(created.id)).toEqual(created);
        });

        it('update replaces the entity and persists it', async () => {
            const created = await repository.create({ name: 'Old', publicKey: randomAddress() });

            const updated = await repository.updateById(created.id, { ...created, name: 'New' });

            expect(updated.name).toEqual('New');
            expect((await repository.getById(created.id)).name).toEqual('New');
        });

        it('update throws EntityNotFound when nothing matches', async () => {
            const created = await repository.create({ name: 'Svc', publicKey: randomAddress() });
            await expect(repository.updateById('missing', { ...created, name: 'New' })).rejects.toThrow(EntityNotFound);
        });

        it('update maps an empty payload to InvalidInputError', async () => {
            const created = await repository.create({ name: 'Svc', publicKey: randomAddress() });
            // Routes now reject partial bodies, but the repo still guards direct empty-payload calls.
            await expect(repository.updateById(created.id, {} as never)).rejects.toThrow(InvalidInputError);
        });

        it('delete removes the entity and returns it', async () => {
            const created = await repository.create({ name: 'Svc', publicKey: randomAddress() });

            const deleted = await repository.deleteById(created.id);
            expect(deleted.id).toBe(created.id);

            expect(await repository.findById(created.id)).toBeUndefined();
        });

        it('delete throws EntityNotFound when nothing matches', async () => {
            await expect(repository.deleteById('missing')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('findPaginated', () => {
        let repository: TestServicesRepository;

        beforeEach<Fixture>(({ db }) => {
            repository = new TestServicesRepository(db);
        });

        it('returns empty items with zeroed metadata when the table is empty', async () => {
            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            expect(result).toEqual({
                items: [],
                pagination: { currentPage: 1, totalPages: 0, totalItems: 0, limit: 10, offset: 0 }
            });
        });

        it('applies the default ordering and limit/offset with full metadata', async () => {
            for (let i = 0; i < 5; i++) {
                await repository.create({ name: `Svc-${i}`, publicKey: randomAddress() });
            }

            const result = await repository.findPaginated({ limit: 2, offset: 2 });

            expect(result.pagination).toEqual({
                currentPage: 2,
                totalPages: 3,
                totalItems: 5,
                limit: 2,
                offset: 2
            });
            expect(result.items.map((i) => i.name)).toEqual(['Svc-2', 'Svc-3']);
        });
    });

    describe('findMany', () => {
        let repository: TestServicesRepository;

        beforeEach<Fixture>(({ db }) => {
            repository = new TestServicesRepository(db);
        });

        it('returns an empty array when nothing matches', async () => {
            expect(await repository.findAllByName('Nope')).toEqual([]);
        });

        it('returns every row matching the filter without pagination', async () => {
            for (let i = 0; i < 3; i++) {
                await repository.create({ name: 'Keep', publicKey: randomAddress() });
            }
            await repository.create({ name: 'Drop', publicKey: randomAddress() });

            const kept = await repository.findAllByName('Keep');

            expect(kept).toHaveLength(3);
            expect(kept.every((s) => s.name === 'Keep')).toBe(true);
        });

        it('applies the default ordering', async () => {
            for (let i = 0; i < 3; i++) {
                await repository.create({ name: `Svc-${i}`, publicKey: randomAddress() });
            }

            const all = await repository.findAll();

            expect(all.map((s) => s.name)).toEqual(['Svc-0', 'Svc-1', 'Svc-2']);
        });

        it('honours an explicit orderBy override', async () => {
            for (let i = 0; i < 3; i++) {
                await repository.create({ name: `Svc-${i}`, publicKey: randomAddress() });
            }

            const all = await repository.findAll([desc(servicesTable.createdAt)]);

            expect(all.map((s) => s.name)).toEqual(['Svc-2', 'Svc-1', 'Svc-0']);
        });
    });

    describe('custom lookup helpers', () => {
        let repository: TestServicesRepository;

        beforeEach<Fixture>(({ db }) => {
            repository = new TestServicesRepository(db);
        });

        it('findOne returns undefined when nothing matches', async () => {
            expect(await repository.findByPublicKey(randomAddress())).toBeUndefined();
        });

        it('findOne returns the matching entity', async () => {
            const publicKey = randomAddress();
            const created = await repository.create({ name: 'Svc', publicKey });

            expect(await repository.findByPublicKey(publicKey)).toEqual(created);
        });

        it('getOne throws EntityNotFound when nothing matches', async () => {
            const publicKey = randomAddress();
            const error = await repository.getByPublicKey(publicKey).catch((e) => e);

            expect(error).toBeInstanceOf(EntityNotFound);
            expect(error.message).toEqual('Service not found');
        });
    });

    describe('filter-based update/delete (multi-row primitives)', () => {
        let repository: TestServicesRepository;

        beforeEach<Fixture>(({ db }) => {
            repository = new TestServicesRepository(db);
        });

        it('update sets data on every matching row and returns all of them', async () => {
            await repository.create({ name: 'Keep', publicKey: randomAddress() });
            await repository.create({ name: 'Keep', publicKey: randomAddress() });
            await repository.create({ name: 'Other', publicKey: randomAddress() });

            const updated = await repository.updateWhere({ name: 'Renamed' }, eq(servicesTable.name, 'Keep'));

            expect(updated).toHaveLength(2);
            expect(updated.every((s) => s.name === 'Renamed')).toBe(true);
            expect(await repository.findAllByName('Renamed')).toHaveLength(2);
            expect(await repository.findAllByName('Other')).toHaveLength(1);
        });

        it('delete removes every matching row and returns all of them', async () => {
            await repository.create({ name: 'Drop', publicKey: randomAddress() });
            await repository.create({ name: 'Drop', publicKey: randomAddress() });
            const keep = await repository.create({ name: 'Keep', publicKey: randomAddress() });

            const deleted = await repository.deleteWhere(eq(servicesTable.name, 'Drop'));

            expect(deleted).toHaveLength(2);
            expect(deleted.every((s) => s.name === 'Drop')).toBe(true);
            expect((await repository.findAll()).map((s) => s.id)).toEqual([keep.id]);
        });

        it('return an empty array when nothing matches', async () => {
            await repository.create({ name: 'Svc', publicKey: randomAddress() });

            expect(await repository.updateWhere({ name: 'X' }, eq(servicesTable.name, 'None'))).toEqual([]);
            expect(await repository.deleteWhere(eq(servicesTable.name, 'None'))).toEqual([]);
        });
    });

    describe('additional read filters (filter?: SQL)', () => {
        let repository: TestServicesRepository;

        beforeEach<Fixture>(({ db }) => {
            repository = new TestServicesRepository(db);
        });

        it('findById ANDs the extra predicate, excluding the row when it does not match', async () => {
            const created = await repository.create({ name: 'Svc', publicKey: randomAddress() });

            expect(await repository.findById(created.id, { filter: eq(servicesTable.name, 'Svc') })).toEqual(created);
            expect(await repository.findById(created.id, { filter: eq(servicesTable.name, 'Other') })).toBeUndefined();
        });

        it('getById throws EntityNotFound when the extra predicate excludes the row', async () => {
            const created = await repository.create({ name: 'Svc', publicKey: randomAddress() });

            expect(await repository.getById(created.id, { filter: eq(servicesTable.name, 'Svc') })).toEqual(created);
            await expect(repository.getById(created.id, { filter: eq(servicesTable.name, 'Other') })).rejects.toThrow(
                EntityNotFound
            );
        });

        it('findOne ANDs the extra predicate with the column match', async () => {
            const publicKey = randomAddress();
            const created = await repository.create({ name: 'Svc', publicKey });

            expect(await repository.findByPublicKey(publicKey, eq(servicesTable.name, 'Svc'))).toEqual(created);
            expect(await repository.findByPublicKey(publicKey, eq(servicesTable.name, 'Other'))).toBeUndefined();
        });

        it('getOne throws EntityNotFound when the extra predicate excludes the row', async () => {
            const publicKey = randomAddress();
            await repository.create({ name: 'Svc', publicKey });

            await expect(repository.getByPublicKey(publicKey, eq(servicesTable.name, 'Other'))).rejects.toThrow(
                EntityNotFound
            );
        });

        it('findPaginated filters items and the total count consistently', async () => {
            for (let i = 0; i < 3; i++) {
                await repository.create({ name: 'Keep', publicKey: randomAddress() });
            }
            for (let i = 0; i < 2; i++) {
                await repository.create({ name: 'Drop', publicKey: randomAddress() });
            }

            const result = await repository.findPaginated(
                { limit: 10, offset: 0 },
                { filter: eq(servicesTable.name, 'Keep') }
            );

            expect(result.pagination.totalItems).toEqual(3);
            expect(result.items).toHaveLength(3);
            expect(result.items.every((s) => s.name === 'Keep')).toBe(true);
        });

        it('findPaginated paginates within the filtered set', async () => {
            for (let i = 0; i < 5; i++) {
                await repository.create({ name: i < 3 ? 'Keep' : 'Drop', publicKey: randomAddress() });
            }

            const result = await repository.findPaginated(
                { limit: 2, offset: 2 },
                { filter: eq(servicesTable.name, 'Keep') }
            );

            expect(result.pagination).toEqual({ currentPage: 2, totalPages: 2, totalItems: 3, limit: 2, offset: 2 });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toEqual('Keep');
        });
    });

    describe('integer identity primary key', () => {
        let contracts: TestContractsRepository;
        let permissions: TestFunctionPermissionsRepository;

        beforeEach<Fixture>(({ db }) => {
            contracts = new TestContractsRepository(db);
            permissions = new TestFunctionPermissionsRepository(db);
        });

        it('round-trips create → getById → delete with numeric ids', async () => {
            const contract = await contracts.create({
                contractAddress: randomAddress(),
                abi: '[]',
                disclosureStartBlock: '0x0'
            });

            const permission = await permissions.create({
                contractAddress: contract.contractAddress,
                methodSelector: '0x12345678',
                accessType: 'read',
                functionSignature: 'foo()',
                ruleType: 'public'
            });

            expect(permission.id).toBeTypeOf('number');
            expect(await permissions.getById(permission.id)).toEqual(permission);

            await permissions.deleteById(permission.id);
            expect(await permissions.findById(permission.id)).toBeUndefined();
        });
    });

    describe('bytea address primary key', () => {
        let contracts: TestContractsRepository;

        beforeEach<Fixture>(({ db }) => {
            contracts = new TestContractsRepository(db);
        });

        it('round-trips create → getById keyed by address', async () => {
            const contractAddress = randomAddress();
            const created = await contracts.create({ contractAddress, abi: '[]', disclosureStartBlock: '0x0' });

            expect(await contracts.getById(contractAddress)).toEqual(created);
            await expect(contracts.getById(randomAddress())).rejects.toThrow(EntityNotFound);
        });
    });

    describe('natural text primary key', () => {
        let roles: TestRolesRepository;

        beforeEach<Fixture>(({ db }) => {
            roles = new TestRolesRepository(db);
        });

        it('keeps the natural key required on insert and round-trips by it', async () => {
            const created = await roles.create({ roleName: 'auditor', systemPermissions: [], isSystemRole: false });

            expect(created.roleName).toEqual('auditor');
            expect(await roles.getById('auditor')).toEqual(created);
        });
    });

    describe('method override with super', () => {
        let roles: TestRolesRepository;

        beforeEach<Fixture>(({ db }) => {
            roles = new TestRolesRepository(db);
        });

        it('rejects updates to system roles', async () => {
            const created = await roles.create({ roleName: 'system', systemPermissions: [], isSystemRole: true });

            await expect(roles.updateById('system', { ...created, systemPermissions: ['admin_read'] })).rejects.toThrow(
                InvalidEntity
            );
        });

        it('delegates non-system updates to the base implementation', async () => {
            const created = await roles.create({ roleName: 'auditor', systemPermissions: [], isSystemRole: false });

            const updated = await roles.updateById('auditor', { ...created, systemPermissions: ['admin_read'] });

            expect(updated.systemPermissions).toEqual(['admin_read']);
        });

        it('still throws EntityNotFound for missing roles', async () => {
            const created = await roles.create({ roleName: 'auditor', systemPermissions: [], isSystemRole: false });

            await expect(roles.updateById('missing', { ...created, roleName: 'missing' })).rejects.toThrow(
                EntityNotFound
            );
        });
    });

    describe('baseFilter', () => {
        let organizations: TestOrganizationsRepository;

        beforeEach<Fixture>(({ db }) => {
            organizations = new TestOrganizationsRepository(db);
        });

        it('excludes filtered-out rows from every read, update and delete', async () => {
            const live = await organizations.create({ name: 'Live Org' });
            const deleted = await organizations.create({ name: 'Deleted Org' });
            await organizations.updateById(deleted.id, { ...deleted, deletedAt: new Date() });

            expect(await organizations.findById(deleted.id)).toBeUndefined();
            expect(await organizations.findByName('Live Org')).toEqual(live);
            expect(await organizations.findByName('Deleted Org')).toBeUndefined();
            await expect(organizations.getById(deleted.id)).rejects.toThrow(EntityNotFound);
            await expect(organizations.getByName('Deleted Org')).rejects.toThrow(EntityNotFound);
            await expect(organizations.updateById(deleted.id, { ...deleted, name: 'X' })).rejects.toThrow(
                EntityNotFound
            );
            await expect(organizations.deleteById(deleted.id)).rejects.toThrow(EntityNotFound);

            const page = await organizations.findPaginated({ limit: 10, offset: 0 });
            expect(page.pagination.totalItems).toEqual(1);
            expect(page.items.map((o) => o.id)).toEqual([live.id]);

            expect((await organizations.findAll()).map((o) => o.id)).toEqual([live.id]);
        });

        it('ANDs a caller filter together with the baseFilter', async () => {
            const keep = await organizations.create({ name: 'Keep' });
            await organizations.create({ name: 'Drop' });
            const deletedButMatching = await organizations.create({ name: 'Keep' });
            await organizations.updateById(deletedButMatching.id, { ...deletedButMatching, deletedAt: new Date() });

            // Caller filter selects name='Keep'; the baseFilter still excludes the soft-deleted 'Keep' row.
            const page = await organizations.findPaginated(
                { limit: 10, offset: 0 },
                { filter: eq(organizationsTable.name, 'Keep') }
            );
            expect(page.pagination.totalItems).toEqual(1);
            expect(page.items.map((o) => o.id)).toEqual([keep.id]);

            // By-id reads honour both filters too.
            expect(await organizations.findById(keep.id, { filter: eq(organizationsTable.name, 'Keep') })).toEqual(
                keep
            );
            expect(
                await organizations.findById(keep.id, { filter: eq(organizationsTable.name, 'Drop') })
            ).toBeUndefined();
        });
    });
});
