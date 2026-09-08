import type { Hex } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError } from '../utils/error-types';
import {
    ContractFunctionPermissionsRepository,
    type FullContractPermission,
    type NewContractPermission
} from './contract-function-permissions-repository';
import { ContractsRepository } from './contracts-repository';
import { RolesRepository } from './roles-repository';

describe('ContractPermissionsRepository', () => {
    let repository: ContractFunctionPermissionsRepository;
    let contractsRepository: ContractsRepository;
    let rolesRepository: RolesRepository;
    let testRoleId: string;
    const contractAddress = '0x1234567890123456789012345678901234567890';
    const testRoleName = 'test-role';

    const sampleAbi = JSON.stringify([
        {
            type: 'function',
            name: 'transfer',
            inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ name: '', type: 'bool' }],
            stateMutability: 'nonpayable'
        },
        {
            type: 'function',
            name: 'approve',
            inputs: [
                { name: 'spender', type: 'address' },
                { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ name: '', type: 'bool' }],
            stateMutability: 'nonpayable'
        },
        {
            type: 'function',
            name: 'balanceOf',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
            stateMutability: 'view'
        },
        {
            type: 'receive',
            stateMutability: 'payable'
        }
    ]);

    beforeEach<Fixture>(async ({ db }) => {
        repository = new ContractFunctionPermissionsRepository(db);
        contractsRepository = new ContractsRepository(db);
        rolesRepository = new RolesRepository(db);

        await contractsRepository.create({
            contractAddress,
            abi: sampleAbi,
            name: 'Test Token',
            description: 'A test ERC20 token',
            discloseErc20TotalSupply: false,
            discloseBytecode: false,
            disclosureStartBlock: '0x0'
        });

        const testRole = await rolesRepository.create({
            roleName: testRoleName,
            systemPermissions: []
        });
        testRoleId = testRole.id;
    });

    describe('create', () => {
        it('should create a public permission', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'read',
                ruleType: 'public'
            };

            const result = await repository.create(permission);

            expect(result).toBeDefined();
            expect(result.contractAddress).toBe(contractAddress);
            expect(result.methodSelector).toBe('0xa9059cbb');
            expect(result.functionSignature).toBe('function transfer(address,uint256)');
            expect(result.accessType).toBe('read');
            expect(result.ruleType).toBe('public');
            expect(result.roles).toEqual([]);
            expect(result.argumentRestrictions).toEqual([]);
        });

        it('should create a checkRole permission', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function approve(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRole',
                roles: [{ id: testRoleId }]
            };

            const result = await repository.create(permission);

            expect(result.ruleType).toBe('checkRole');
            expect(result.roles).toHaveLength(1);
            expect(result.roles?.[0]?.roleName).toBe(testRoleName);
            expect(result.argumentRestrictions).toEqual([]);
        });

        it('should create a restrictArgument permission', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'restrictArgument',
                argumentRestrictions: [{ argumentIndex: 0 }]
            };

            const result = await repository.create(permission);

            expect(result.ruleType).toBe('restrictArgument');
            expect(result.argumentRestrictions).toHaveLength(1);
            expect(result.argumentRestrictions?.[0]?.argumentIndex).toBe(0);
            expect(result.roles).toEqual([]);
        });

        it('should create a checkRoleAndRestrictArgument permission', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRoleAndRestrictArgument',
                roles: [{ id: testRoleId }],
                argumentRestrictions: [{ argumentIndex: 1 }]
            };

            const result = await repository.create(permission);

            expect(result.ruleType).toBe('checkRoleAndRestrictArgument');
            expect(result.roles).toHaveLength(1);
            expect(result.argumentRestrictions).toHaveLength(1);
        });

        it('should create a checkRoleOrRestrictArgument permission', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function approve(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRoleOrRestrictArgument',
                roles: [{ id: testRoleId }],
                argumentRestrictions: [{ argumentIndex: 0 }, { argumentIndex: 1 }]
            };

            const result = await repository.create(permission);

            expect(result.ruleType).toBe('checkRoleOrRestrictArgument');
            expect(result.roles).toHaveLength(1);
            expect(result.argumentRestrictions).toHaveLength(2);
        });

        it('should handle receive function with 0x selector', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'receive() external payable',
                methodSelector: '0x' as Hex,
                accessType: 'write',
                ruleType: 'public'
            };

            const result = await repository.create(permission);

            expect(result.methodSelector).toBe('0x');
            expect(result.functionSignature).toBe('receive() external payable');
        });

        it('should throw if contract does not exist', async () => {
            const permission: NewContractPermission = {
                contractAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'read',
                ruleType: 'public'
            };

            await expect(repository.create(permission)).rejects.toThrow(EntityNotFound);
        });

        it('should throw if permission already exists', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'read',
                ruleType: 'public'
            };

            await repository.create(permission);
            await expect(repository.create(permission)).rejects.toThrow(EntityAlreadyExistsError);
        });

        it('should throw if selector and signature mismatch', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                methodSelector: '0xwrongselector' as Hex,
                accessType: 'read',
                ruleType: 'public'
            };

            await expect(repository.create(permission)).rejects.toThrow(InvalidInputError);
        });

        it('should throw if function not in ABI', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function nonExistent(uint256)',
                accessType: 'read',
                ruleType: 'public'
            };

            await expect(repository.create(permission)).rejects.toThrow(InvalidInputError);
        });

        it('should throw if role does not exist', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRole',
                roles: [{ id: 'non-existent-role' }]
            };

            await expect(repository.create(permission)).rejects.toThrow(InvalidInputError);
        });

        it('should throw if argument index out of bounds', async () => {
            const permission: NewContractPermission = {
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'restrictArgument',
                argumentRestrictions: [{ argumentIndex: 5 }] // Only has 2 arguments
            };

            await expect(repository.create(permission)).rejects.toThrow(InvalidInputError);
        });

        it('should throw for invalid rule type combinations', async () => {
            // Public with roles
            await expect(
                repository.create({
                    contractAddress,
                    functionSignature: 'function transfer(address,uint256)',
                    accessType: 'read',
                    ruleType: 'public',
                    roles: [{ id: testRoleId }]
                })
            ).rejects.toThrow(InvalidInputError);

            // Public with argument restrictions
            await expect(
                repository.create({
                    contractAddress,
                    functionSignature: 'function transfer(address,uint256)',
                    accessType: 'read',
                    ruleType: 'public',
                    argumentRestrictions: [{ argumentIndex: 0 }]
                })
            ).rejects.toThrow(InvalidInputError);

            // CheckRole without roles
            await expect(
                repository.create({
                    contractAddress,
                    functionSignature: 'function transfer(address,uint256)',
                    accessType: 'read',
                    ruleType: 'checkRole'
                })
            ).rejects.toThrow(InvalidInputError);

            // RestrictArgument without restrictions
            await expect(
                repository.create({
                    contractAddress,
                    functionSignature: 'function transfer(address,uint256)',
                    accessType: 'read',
                    ruleType: 'restrictArgument'
                })
            ).rejects.toThrow(InvalidInputError);
        });
    });

    describe('getPermissionById', () => {
        let createdPermission: FullContractPermission;

        beforeEach(async () => {
            createdPermission = await repository.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRole',
                roles: [{ id: testRoleId }]
            });
        });

        it('should get permission by id', async () => {
            const result = await repository.getPermissionById(createdPermission.id);

            expect(result).toBeDefined();
            expect(result.id).toBe(createdPermission.id);
            expect(result.functionSignature).toBe('function transfer(address,uint256)');
            expect(result.roles).toHaveLength(1);
        });

        it('should throw if permission not found', async () => {
            await expect(repository.getPermissionById(999999)).rejects.toThrow(EntityNotFound);
        });
    });

    describe('update', () => {
        let createdPermission: FullContractPermission;

        beforeEach(async () => {
            createdPermission = await repository.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'read',
                ruleType: 'public'
            });
        });

        it('should update a permission', async () => {
            const updated = await repository.update(createdPermission.id, {
                ...createdPermission,
                accessType: 'write'
            });

            expect(updated.id).toBe(createdPermission.id);
            expect(updated.accessType).toBe('write');
        });

        it('should update roles', async () => {
            const updated = await repository.update(createdPermission.id, {
                ...createdPermission,
                ruleType: 'checkRole',
                roles: [{ id: testRoleId }]
            });

            expect(updated.roles).toHaveLength(1);
            expect(updated.roles?.[0]?.roleName).toBe(testRoleName);
        });

        it('should throw if permission not found', async () => {
            await expect(
                repository.update(999999, {
                    contractAddress,
                    methodSelector: '0xa9059cbb' as Hex,
                    functionSignature: 'function transfer(address,uint256)',
                    accessType: 'write',
                    ruleType: 'public'
                })
            ).rejects.toThrow(EntityNotFound);
        });

        it('should throw on id mismatch', async () => {
            await expect(
                repository.update(createdPermission.id, {
                    ...createdPermission,
                    id: 999999
                })
            ).rejects.toThrow(InvalidInputError);
        });
    });

    describe('delete', () => {
        let createdPermission: FullContractPermission;

        beforeEach(async () => {
            createdPermission = await repository.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRoleAndRestrictArgument',
                roles: [{ id: testRoleId }],
                argumentRestrictions: [{ argumentIndex: 0 }]
            });
        });

        it('should delete a permission', async () => {
            await repository.delete(createdPermission.id);
            await expect(repository.getPermissionById(createdPermission.id)).rejects.toThrow(EntityNotFound);
        });

        it('should throw if permission not found', async () => {
            await expect(repository.delete(999999)).rejects.toThrow(EntityNotFound);
        });
    });

    describe('findPaginated', () => {
        beforeEach(async () => {
            await repository.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'read',
                ruleType: 'public'
            });
            await repository.create({
                contractAddress,
                functionSignature: 'function approve(address,uint256)',
                accessType: 'write',
                ruleType: 'checkRole',
                roles: [{ id: testRoleId }]
            });
            await repository.create({
                contractAddress,
                functionSignature: 'function balanceOf(address)',
                accessType: 'read',
                ruleType: 'public'
            });

            const anotherContract = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
            await contractsRepository.create({
                contractAddress: anotherContract,
                abi: sampleAbi,
                name: 'Another Token',
                description: 'Another test token',
                discloseErc20TotalSupply: false,
                discloseBytecode: false,
                disclosureStartBlock: '0x0'
            });
            await repository.create({
                contractAddress: anotherContract,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'public'
            });
        });

        it('should return paginated results', async () => {
            const result = await repository.findPaginated({}, { limit: 2, offset: 0 });

            expect(result.items).toHaveLength(2);
            expect(result.pagination.totalItems).toBe(4);
            expect(result.pagination.totalPages).toBe(2);
            expect(result.pagination.currentPage).toBe(1);
        });

        it('should filter by contract address', async () => {
            const result = await repository.findPaginated({ contractAddress }, { limit: 10, offset: 0 });

            expect(result.items).toHaveLength(3); // 3 permissions for first contract
            expect(result.items.every((item) => item.contractAddress === contractAddress)).toBe(true);
        });

        it('should filter by method selector', async () => {
            const result = await repository.findPaginated(
                { methodSelector: '0xa9059cbb' as Hex }, // transfer selector
                { limit: 10, offset: 0 }
            );

            expect(result.items).toHaveLength(2); // 2 transfer permissions (one per contract)
            expect(result.items.every((item) => item.methodSelector === '0xa9059cbb')).toBe(true);
        });

        it('should filter by both contract and selector', async () => {
            const result = await repository.findPaginated(
                { contractAddress, methodSelector: '0xa9059cbb' as Hex },
                { limit: 10, offset: 0 }
            );

            expect(result.items).toHaveLength(1); // Only 1 transfer permission for first contract
            expect(
                result.items.every(
                    (item) => item.contractAddress === contractAddress && item.methodSelector === '0xa9059cbb'
                )
            ).toBe(true);
        });

        it('should handle pagination with offset', async () => {
            const page1 = await repository.findPaginated({}, { limit: 2, offset: 0 });
            const page2 = await repository.findPaginated({}, { limit: 2, offset: 2 });

            expect(page1.items).toHaveLength(2);
            expect(page2.items).toHaveLength(2);
            expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
            expect(page2.pagination.currentPage).toBe(2);
        });
    });
});
