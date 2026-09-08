import { type Hex, pad, parseAbiItem, toEventSelector } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { EntityNotFound, InvalidInputError } from '../utils/error-types';
import {
    ContractEventsPermissionsRepository,
    type InsertEventPermission
} from './contract-events-permissions-repository';
import { ContractsRepository } from './contracts-repository';
import { RolesRepository } from './roles-repository';

describe('ContractEventsPermissionsRepository', () => {
    let repository: ContractEventsPermissionsRepository;
    let contractsRepository: ContractsRepository;
    let rolesRepository: RolesRepository;
    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
    const transferEventSelector = toEventSelector(transferEvent);

    const validAbi = JSON.stringify([transferEvent]);

    const testContractAddress = '0x1234567890123456789012345678901234567890' as Hex;

    beforeEach<Fixture>(async ({ db }) => {
        contractsRepository = new ContractsRepository(db);
        rolesRepository = new RolesRepository(db);
        repository = new ContractEventsPermissionsRepository(db);

        await contractsRepository.create({
            contractAddress: testContractAddress,
            abi: validAbi,
            name: 'Test Contract',
            description: 'A test contract',
            discloseErc20TotalSupply: false,
            discloseBytecode: true,
            disclosureStartBlock: '0x0',
            disclosedAddresses: []
        });
    });

    describe('create', () => {
        it('creates an event permission with topic0', async () => {
            const result = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            expect(result.contractAddress).toBe(testContractAddress);
            expect(result.topic0Constant).toBe(transferEventSelector);
            expect(result.topic1Constant).toBeNull();
            expect(result.topic2Constant).toBeNull();
            expect(result.topic3Constant).toBeNull();
            expect(result.id).toBeDefined();
        });

        it('creates an event permission with topic conditions', async () => {
            const topic1Value = '0x0000000000000000000000001234567890123456789012345678901234567890';

            const result = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: topic1Value,
                topic1ConditionType: 'equalTo',
                topic2Constant: null,
                topic3Constant: null
            });

            expect(result.topic1Constant).toBe(topic1Value);
            expect(result.topic1ConditionType).toBe('equalTo');
        });

        it('creates an event permission with user-address condition', async () => {
            const result = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic1ConditionType: 'userAddress',
                topic2Constant: null,
                topic3Constant: null
            });

            expect(result.topic1Constant).toBeNull();
            expect(result.topic1ConditionType).toBe('userAddress');
        });

        describe('wrong values', () => {
            type PossibleErrors = typeof EntityNotFound | typeof InvalidInputError;
            async function creationFails(fields: Partial<InsertEventPermission>, e: PossibleErrors) {
                await expect(
                    repository.create({
                        contractAddress: fields.contractAddress ?? testContractAddress,
                        roles: fields.roles ?? [],
                        topic0Constant: fields.topic0Constant ?? null,
                        topic1Constant: fields.topic1Constant ?? null,
                        topic2Constant: fields.topic2Constant ?? null,
                        topic3Constant: fields.topic3Constant ?? null,
                        topic1ConditionType: fields.topic1ConditionType ?? null,
                        topic2ConditionType: fields.topic2ConditionType ?? null,
                        topic3ConditionType: fields.topic3ConditionType ?? null
                    })
                ).rejects.toThrow(e);
            }

            it('fails when role does not exist', async () => {
                await creationFails({ roles: [{ id: 'does-not-exist' }] }, EntityNotFound);
            });

            it('fails when type and constant dont match', async () => {
                await creationFails(
                    { topic1ConditionType: 'userAddress', topic1Constant: pad('0x01') },
                    InvalidInputError
                );
                await creationFails(
                    { topic2ConditionType: 'userAddress', topic2Constant: pad('0x01') },
                    InvalidInputError
                );
                await creationFails(
                    { topic3ConditionType: 'userAddress', topic3Constant: pad('0x01') },
                    InvalidInputError
                );
            });

            it('throws when type is equalTo but no constant', async () => {
                await creationFails({ topic1ConditionType: 'equalTo', topic1Constant: null }, InvalidInputError);
                await creationFails({ topic2ConditionType: 'equalTo', topic2Constant: null }, InvalidInputError);
                await creationFails({ topic3ConditionType: 'equalTo', topic3Constant: null }, InvalidInputError);
            });

            it('throws when event selector does not exist', async () => {
                const fakeSelector = pad('0xffff');
                await creationFails({ topic0Constant: fakeSelector }, InvalidInputError);
            });

            it('throws when constant is longer than 32 bytes', async () => {
                const fakeSelector = pad('0xffff', { size: 33 });
                await creationFails(
                    { topic1Constant: fakeSelector, topic1ConditionType: 'equalTo' },
                    InvalidInputError
                );
            });

            it('throws when constant is shorter than 32 bytes', async () => {
                const fakeSelector = pad('0xffff', { size: 31 });
                await creationFails(
                    { topic1Constant: fakeSelector, topic1ConditionType: 'equalTo' },
                    InvalidInputError
                );
            });

            it('throws for non existing contract', async () => {
                const nonExistingContract = pad('0x11', { size: 20 });
                await creationFails({ contractAddress: nonExistingContract }, EntityNotFound);
            });
        });

        it('throws InvalidInputError when user-address condition has constant', async () => {
            const topic1Value = '0x0000000000000000000000001234567890123456789012345678901234567890';

            await expect(
                repository.create({
                    roles: [],
                    contractAddress: testContractAddress,
                    topic0Constant: transferEventSelector,
                    topic1Constant: topic1Value,
                    topic1ConditionType: 'userAddress',
                    topic2Constant: null,
                    topic3Constant: null
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('creates an event permission with roles', async () => {
            const roleA = await rolesRepository.create({ roleName: 'role-a', systemPermissions: [] });
            const roleB = await rolesRepository.create({ roleName: 'role-b', systemPermissions: [] });

            const result = await repository.create({
                roles: [{ id: roleA.id }, { id: roleB.id }],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            expect(result.contractAddress).toBe(testContractAddress);
            expect(result.topic0Constant).toBe(transferEventSelector);
            expect(result.roles).toHaveLength(2);
            expect(result.roles.map((r) => r.roleName).sort()).toEqual(['role-a', 'role-b']);
        });

        it('creates an event permission with roles and retrieves them via getById', async () => {
            const viewerRole = await rolesRepository.create({ roleName: 'viewer', systemPermissions: [] });
            const editorRole = await rolesRepository.create({ roleName: 'editor', systemPermissions: [] });

            const created = await repository.create({
                roles: [{ id: viewerRole.id }, { id: editorRole.id }],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const found = await repository.getById(created.id);

            expect(found.roles).toHaveLength(2);
            expect(found.roles.map((r) => r.roleName).sort()).toEqual(['editor', 'viewer']);
        });
    });

    describe('getById', () => {
        it('finds an existing event permission', async () => {
            const created = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const result = await repository.getById(created.id);

            expect(result.id).toBe(created.id);
            expect(result.contractAddress).toBe(testContractAddress);
            expect(result.topic0Constant).toBe(transferEventSelector);
        });

        it('throws EntityNotFound for non-existent id', async () => {
            await expect(repository.getById('non-existent-id')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('findPaginated', () => {
        it('returns empty array when no permissions exist', async () => {
            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            expect(result.items).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(0);
        });

        it('returns paginated results', async () => {
            for (let i = 0; i < 5; i++) {
                await repository.create({
                    roles: [],
                    contractAddress: testContractAddress,
                    topic0Constant: transferEventSelector,
                    topic1Constant: null,
                    topic2Constant: null,
                    topic3Constant: null
                });
            }

            const page1 = await repository.findPaginated({ limit: 2, offset: 0 });
            expect(page1.items).toHaveLength(2);
            expect(page1.pagination.totalItems).toBe(5);
            expect(page1.pagination.currentPage).toBe(1);

            const page2 = await repository.findPaginated({ limit: 2, offset: 2 });
            expect(page2.items).toHaveLength(2);
            expect(page2.pagination.currentPage).toBe(2);

            const page3 = await repository.findPaginated({ limit: 2, offset: 4 });
            expect(page3.items).toHaveLength(1);
            expect(page3.pagination.currentPage).toBe(3);
        });
    });

    describe('update', () => {
        it('updates an event permission', async () => {
            const created = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const topic1Value = '0x0000000000000000000000001234567890123456789012345678901234567890';
            const result = await repository.updateById(created.id, {
                ...created,
                topic1Constant: topic1Value,
                topic1ConditionType: 'equalTo'
            });

            expect(result.id).toBe(created.id);
            expect(result.topic1Constant).toBe(topic1Value);
            expect(result.topic1ConditionType).toBe('equalTo');
        });

        it('throws EntityNotFound for non-existent id', async () => {
            const created = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            await expect(repository.updateById('non-existent-id', { ...created })).rejects.toThrow(EntityNotFound);
        });

        it('validates fields on update', async () => {
            const created = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            await expect(
                repository.updateById(created.id, {
                    ...created,
                    topic1ConditionType: 'equalTo'
                })
            ).rejects.toThrow(InvalidInputError);
        });

        it('adds new roles on update', async () => {
            const roleA = await rolesRepository.create({ roleName: 'role-a', systemPermissions: [] });
            const roleB = await rolesRepository.create({ roleName: 'role-b', systemPermissions: [] });

            const created = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            expect(created.roles).toHaveLength(0);

            const updated = await repository.updateById(created.id, {
                ...created,
                roles: [{ id: roleA.id }, { id: roleB.id }]
            });

            expect(updated.roles).toHaveLength(2);
            expect(updated.roles.map((r) => r.roleName).sort()).toEqual(['role-a', 'role-b']);
        });

        it('removes roles on update', async () => {
            const roleToKeep = await rolesRepository.create({ roleName: 'role-to-keep', systemPermissions: [] });
            const roleToRemove = await rolesRepository.create({ roleName: 'role-to-remove', systemPermissions: [] });

            const created = await repository.create({
                roles: [{ id: roleToKeep.id }, { id: roleToRemove.id }],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            expect(created.roles).toHaveLength(2);

            const updated = await repository.updateById(created.id, {
                ...created,
                roles: [{ id: roleToKeep.id }]
            });

            expect(updated.roles).toHaveLength(1);
            expect(updated.roles[0]?.roleName).toBe('role-to-keep');
        });

        it('handles mixed role changes: adds new, removes old, keeps unchanged', async () => {
            const roleUnchanged = await rolesRepository.create({ roleName: 'role-unchanged', systemPermissions: [] });
            const roleToRemove = await rolesRepository.create({ roleName: 'role-to-remove', systemPermissions: [] });
            const roleToAdd = await rolesRepository.create({ roleName: 'role-to-add', systemPermissions: [] });

            const created = await repository.create({
                roles: [{ id: roleUnchanged.id }, { id: roleToRemove.id }],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            expect(created.roles).toHaveLength(2);
            expect(created.roles.map((r) => r.roleName).sort()).toEqual(['role-to-remove', 'role-unchanged']);

            const updated = await repository.updateById(created.id, {
                ...created,
                roles: [{ id: roleUnchanged.id }, { id: roleToAdd.id }]
            });

            expect(updated.roles).toHaveLength(2);
            expect(updated.roles.map((r) => r.roleName).sort()).toEqual(['role-to-add', 'role-unchanged']);

            // Verify via getById to ensure persistence
            const found = await repository.getById(created.id);
            expect(found.roles).toHaveLength(2);
            expect(found.roles.map((r) => r.roleName).sort()).toEqual(['role-to-add', 'role-unchanged']);
        });

        it('does not modify roles when update includes the same roles', async () => {
            const role1 = await rolesRepository.create({ roleName: 'role-1', systemPermissions: [] });
            const role2 = await rolesRepository.create({ roleName: 'role-2', systemPermissions: [] });

            const created = await repository.create({
                roles: [{ id: role1.id }, { id: role2.id }],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            // Update with the same roles (order might differ)
            const updated = await repository.updateById(created.id, {
                ...created,
                roles: [{ id: role2.id }, { id: role1.id }]
            });

            // This includes checks to "updatedAt"
            expect(updated.roles).toEqual(created.roles);
        });

        it('clears all roles when updated with empty roles array', async () => {
            const roleX = await rolesRepository.create({ roleName: 'role-x', systemPermissions: [] });
            const roleY = await rolesRepository.create({ roleName: 'role-y', systemPermissions: [] });

            const created = await repository.create({
                roles: [{ id: roleX.id }, { id: roleY.id }],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            expect(created.roles).toHaveLength(2);

            const updated = await repository.updateById(created.id, {
                ...created,
                roles: []
            });

            expect(updated.roles).toHaveLength(0);

            // Verify via getById
            const found = await repository.getById(created.id);
            expect(found.roles).toHaveLength(0);
        });
    });

    describe('delete', () => {
        it('deletes an existing event permission', async () => {
            const created = await repository.create({
                roles: [],
                contractAddress: testContractAddress,
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            await repository.deleteById(created.id);

            await expect(repository.getById(created.id)).rejects.toThrow(EntityNotFound);
        });

        it('cal delete a permission with roles', async () => {
            const role1 = await rolesRepository.create({ roleName: 'role1', systemPermissions: [] });
            const role2 = await rolesRepository.create({ roleName: 'role2', systemPermissions: [] });
            const created = await repository.create({
                roles: [role1, role2],
                contractAddress: testContractAddress,
                topic0Constant: null,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            await repository.deleteById(created.id);
            expect(await rolesRepository.findScoped(role1.id)).toEqual(role1);
            expect(await rolesRepository.findScoped(role2.id)).toEqual(role2);
        });

        it('throws EntityNotFound for non-existent id', async () => {
            await expect(repository.deleteById('non-existent-id')).rejects.toThrow(EntityNotFound);
        });
    });
});
