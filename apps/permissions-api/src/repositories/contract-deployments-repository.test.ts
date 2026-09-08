import type { Address, Hex } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { UserSources } from '../db/schema';
import { EntityNotFound } from '../utils/error-types';
import { ContractDeploymentsRepository, type CreateContractDeployment } from './contract-deployments-repository';
import { UsersRepository } from './users-repository';

describe('ContractDeploymentsRepository', () => {
    let repository: ContractDeploymentsRepository;
    let usersRepository: UsersRepository;
    let testUserId: string;

    const testDeployerAddress = '0x1234567890123456789012345678901234567890' as Address;
    const testContractAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
    const testTxHash = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;

    beforeEach<Fixture>(async ({ db }) => {
        usersRepository = new UsersRepository(db);
        repository = new ContractDeploymentsRepository(db);

        // Create a test user for deployedBy reference
        const user = await usersRepository.create({
            oidcSub: 'deployer-user',
            displayName: 'Deployer User',
            wallets: [testDeployerAddress],
            source: UserSources.enum.adminPanel
        });
        testUserId = user.id;
    });

    function createDeploymentData(overrides?: Partial<CreateContractDeployment>): CreateContractDeployment {
        return {
            address: testContractAddress,
            deployerAddress: testDeployerAddress,
            deployerNonce: 1,
            deployTxHash: testTxHash,
            ...overrides
        };
    }

    describe('create', () => {
        it('creates a contract deployment with all fields', async () => {
            const deploymentData = createDeploymentData();

            const result = await repository.create(deploymentData);

            expect(result.address.toLowerCase()).toBe(testContractAddress.toLowerCase());
            expect(result.deployerAddress.toLowerCase()).toBe(testDeployerAddress.toLowerCase());
            expect(result.deployerNonce).toBe(1);
            expect(result.deployTxHash).toBe(testTxHash);
            expect(result.deployedBy).toBe(testUserId);
            expect(result.id).toBeDefined();
            expect(result.createdAt).toBeDefined();
        });

        it('creates a contract deployment with explicit deployedBy', async () => {
            const deploymentData = createDeploymentData({ deployedBy: testUserId });

            const result = await repository.create(deploymentData);

            expect(result.deployedBy).toBe(testUserId);
        });

        it('throws EntityNotFound when deployer address does not belong to any user', async () => {
            const unknownAddress = '0x9999999999999999999999999999999999999999' as Address;
            const deploymentData = createDeploymentData({ deployerAddress: unknownAddress });

            await expect(repository.create(deploymentData)).rejects.toThrow(EntityNotFound);
        });

        it('creates multiple deployments with different addresses', async () => {
            const deployment1 = createDeploymentData({ deployerNonce: 1 });
            const deployment2 = createDeploymentData({
                address: '0x2222222222222222222222222222222222222222' as Address,
                deployerNonce: 2,
                deployTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex
            });

            const result1 = await repository.create(deployment1);
            const result2 = await repository.create(deployment2);

            expect(result1.id).not.toBe(result2.id);
            expect(result1.deployerNonce).toBe(1);
            expect(result2.deployerNonce).toBe(2);
        });
    });

    describe('success', () => {
        it('marks a deployment as successful', async () => {
            const deployment = await repository.create(createDeploymentData());

            const result = await repository.success(deployment.id);

            expect(result.id).toBe(deployment.id);
            expect(result).toEqual({
                ...deployment,
                successAt: expect.toSatisfy((o) => o instanceof Date),
                updatedAt: expect.toSatisfy((o) => o > deployment.updatedAt)
            });
        });

        it('throws EntityNotFound for non-existent deployment', async () => {
            await expect(repository.success('non-existent-id')).rejects.toThrow(EntityNotFound);
        });

        it('only marks the targeted deployment as successful without affecting others', async () => {
            const deployment1 = await repository.create(
                createDeploymentData({
                    address: '0x1111111111111111111111111111111111111111' as Address,
                    deployerNonce: 1,
                    deployTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex
                })
            );
            const deployment2 = await repository.create(
                createDeploymentData({
                    address: '0x2222222222222222222222222222222222222222' as Address,
                    deployerNonce: 2,
                    deployTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex
                })
            );
            const deployment3 = await repository.create(
                createDeploymentData({
                    address: '0x3333333333333333333333333333333333333333' as Address,
                    deployerNonce: 3,
                    deployTxHash: '0x3333333333333333333333333333333333333333333333333333333333333333' as Hex
                })
            );

            // Mark only deployment2 as successful
            await repository.success(deployment2.id);

            // Fetch all deployments and verify only deployment2 has successAt set
            const result = await repository.searchPaginated({ limit: 10, offset: 0 });
            const items = result.items;

            const deployment1AfterSuccess = items.find((d) => d.id === deployment1.id);
            const deployment2AfterSuccess = items.find((d) => d.id === deployment2.id);
            const deployment3AfterSuccess = items.find((d) => d.id === deployment3.id);

            expect(deployment1AfterSuccess?.successAt).toBeNull();
            expect(deployment2AfterSuccess?.successAt).not.toBeNull();
            expect(deployment3AfterSuccess?.successAt).toBeNull();
        });

        it('is idempotent when deployment is already marked as successful', async () => {
            // Authorship reconciliation can have two concurrent readers calling
            // success() on the same pending row; the second call must return
            // the existing successful row rather than throw.
            const deployment = await repository.create(createDeploymentData()).then(({ id }) => repository.success(id));

            const second = await repository.success(deployment.id);

            expect(second.id).toBe(deployment.id);
            expect(second.successAt).toEqual(deployment.successAt);

            // Verify state remains unchanged
            const result = await repository.searchPaginated({ limit: 10, offset: 0 });
            const deploymentAfter = result.items.find((d) => d.id === deployment.id);
            expect(deploymentAfter?.successAt).toEqual(deployment.successAt);
            expect(deploymentAfter?.erroredAt).toEqual(deployment.erroredAt);
        });

        it('throws when deployment was already marked as errored', async () => {
            const deployment = await repository
                .create(createDeploymentData())
                .then(({ id }) => repository.error(id, 'Some error'));

            await expect(repository.success(deployment.id)).rejects.toThrow(
                'Cannot mark an errored deployment as successful.'
            );

            // Verify state remains unchanged
            const result = await repository.searchPaginated({ limit: 10, offset: 0 });
            const deploymentAfter = result.items.find((d) => d.id === deployment.id);
            expect(deploymentAfter?.successAt).toEqual(deployment.successAt);
            expect(deploymentAfter?.erroredAt).toEqual(deployment.erroredAt);
            expect(deploymentAfter?.errorMessage).toEqual(deployment.errorMessage);
        });
    });

    describe('error', () => {
        it('marks a deployment as errored with message', async () => {
            const deployment = await repository.create(createDeploymentData());
            const errorMessage = 'Deployment failed due to insufficient gas';

            const result = await repository.error(deployment.id, errorMessage);

            expect(result.id).toBe(deployment.id);
            expect(result).toEqual({
                ...deployment,
                erroredAt: expect.toSatisfy((o) => o instanceof Date),
                errorMessage,
                updatedAt: expect.toSatisfy((o) => o > deployment.updatedAt)
            });
        });

        it('throws EntityNotFound for non-existent deployment', async () => {
            await expect(repository.error('non-existent-id', 'Some error')).rejects.toThrow(EntityNotFound);
        });

        it('only marks the targeted deployment as errored without affecting others', async () => {
            const deployment1 = await repository.create(
                createDeploymentData({
                    address: '0x1111111111111111111111111111111111111111' as Address,
                    deployerNonce: 1,
                    deployTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex
                })
            );
            const deployment2 = await repository.create(
                createDeploymentData({
                    address: '0x2222222222222222222222222222222222222222' as Address,
                    deployerNonce: 2,
                    deployTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex
                })
            );
            const deployment3 = await repository.create(
                createDeploymentData({
                    address: '0x3333333333333333333333333333333333333333' as Address,
                    deployerNonce: 3,
                    deployTxHash: '0x3333333333333333333333333333333333333333333333333333333333333333' as Hex
                })
            );

            // Mark only deployment2 as errored
            const errorMessage = 'Deployment failed due to insufficient gas';
            await repository.error(deployment2.id, errorMessage);

            // Fetch all deployments and verify only deployment2 has erroredAt set
            const result = await repository.searchPaginated({ limit: 10, offset: 0 });
            const items = result.items;

            const deployment1AfterError = items.find((d) => d.id === deployment1.id);
            const deployment2AfterError = items.find((d) => d.id === deployment2.id);
            const deployment3AfterError = items.find((d) => d.id === deployment3.id);

            expect(deployment1AfterError?.erroredAt).toBeNull();
            expect(deployment1AfterError?.errorMessage).toBeNull();
            expect(deployment2AfterError?.erroredAt).not.toBeNull();
            expect(deployment2AfterError?.errorMessage).toBe(errorMessage);
            expect(deployment3AfterError?.erroredAt).toBeNull();
            expect(deployment3AfterError?.errorMessage).toBeNull();
        });

        it('throws when deployment was already marked as successful', async () => {
            const deployment = await repository.create(createDeploymentData()).then(({ id }) => repository.success(id));

            await expect(repository.error(deployment.id, 'Some error')).rejects.toThrow(
                'Cannot resolve a contract deployment that was already resolved.'
            );

            // Verify state remains unchanged
            const result = await repository.searchPaginated({ limit: 10, offset: 0 });
            const deploymentAfter = result.items.find((d) => d.id === deployment.id);
            expect(deploymentAfter?.successAt).toEqual(deployment.successAt);
            expect(deploymentAfter?.erroredAt).toEqual(deployment.erroredAt);
            expect(deploymentAfter?.errorMessage).toEqual(deployment.errorMessage);
        });

        it('throws when deployment was already marked as errored', async () => {
            const deployment = await repository
                .create(createDeploymentData())
                .then(({ id }) => repository.error(id, 'First error'));

            await expect(repository.error(deployment.id, 'Second error')).rejects.toThrow(
                'Cannot resolve a contract deployment that was already resolved.'
            );

            // Verify state remains unchanged
            const result = await repository.searchPaginated({ limit: 10, offset: 0 });
            const deploymentAfter = result.items.find((d) => d.id === deployment.id);
            expect(deploymentAfter?.successAt).toEqual(deployment.successAt);
            expect(deploymentAfter?.erroredAt).toEqual(deployment.erroredAt);
            expect(deploymentAfter?.errorMessage).toEqual(deployment.errorMessage);
        });
    });

    describe('searchPaginated', () => {
        it('returns empty results when no deployments exist', async () => {
            const result = await repository.searchPaginated({ limit: 10, offset: 0 });

            expect(result.items).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(0);
            expect(result.pagination.totalPages).toBe(0);
            expect(result.pagination.currentPage).toBe(1);
        });

        it('returns paginated results with correct pagination metadata', async () => {
            // Create multiple deployments
            for (let i = 0; i < 5; i++) {
                await repository.create(
                    createDeploymentData({
                        address: `0x${(i + 1).toString().padStart(40, '0')}` as Address,
                        deployerNonce: i + 1,
                        deployTxHash: `0x${(i + 1).toString().padStart(64, '0')}` as Hex
                    })
                );
            }

            const result = await repository.searchPaginated({ limit: 2, offset: 0 });

            expect(result.items).toHaveLength(2);
            expect(result.pagination.totalItems).toBe(5);
            expect(result.pagination.totalPages).toBe(3);
            expect(result.pagination.currentPage).toBe(1);
            expect(result.pagination.limit).toBe(2);
            expect(result.pagination.offset).toBe(0);
        });

        it('returns correct page when offset is provided', async () => {
            // Create multiple deployments
            for (let i = 0; i < 5; i++) {
                await repository.create(
                    createDeploymentData({
                        address: `0x${(i + 1).toString().padStart(40, '0')}` as Address,
                        deployerNonce: i + 1,
                        deployTxHash: `0x${(i + 1).toString().padStart(64, '0')}` as Hex
                    })
                );
            }

            const page2 = await repository.searchPaginated({ limit: 2, offset: 2 });

            expect(page2.items).toHaveLength(2);
            expect(page2.pagination.currentPage).toBe(2);
            expect(page2.pagination.totalItems).toBe(5);
        });

        it('returns remaining items on last page', async () => {
            // Create 5 deployments
            for (let i = 0; i < 5; i++) {
                await repository.create(
                    createDeploymentData({
                        address: `0x${(i + 1).toString().padStart(40, '0')}` as Address,
                        deployerNonce: i + 1,
                        deployTxHash: `0x${(i + 1).toString().padStart(64, '0')}` as Hex
                    })
                );
            }

            const lastPage = await repository.searchPaginated({ limit: 2, offset: 4 });

            expect(lastPage.items).toHaveLength(1);
            expect(lastPage.pagination.currentPage).toBe(3);
        });
    });
});
