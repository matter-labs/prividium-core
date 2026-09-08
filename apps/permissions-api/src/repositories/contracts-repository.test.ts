import { type Address, getAddress } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError } from '../utils/error-types';
import { type ContractCreate, ContractsRepository, type ContractUpdate } from './contracts-repository';

describe('ContractsRepository', () => {
    let repository: ContractsRepository;
    const validAbi = JSON.stringify([
        {
            inputs: [],
            name: 'totalSupply',
            outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function'
        }
    ]);

    const testContract = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        abi: validAbi,
        name: 'Test Contract',
        description: 'A test contract',
        discloseErc20TotalSupply: true,
        discloseBytecode: true,
        disclosureStartBlock: '0x0',
        disclosedAddresses: [
            { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
            { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
        ]
    } as const satisfies ContractCreate;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new ContractsRepository(db);
    });

    describe('create', () => {
        it('should create a contract with all fields', async () => {
            const result = await repository.create(testContract);

            expect(result.contractAddress).toBe(testContract.contractAddress);
            expect(result.abi).toBe(testContract.abi);
            expect(result.name).toBe(testContract.name);
            expect(result.description).toBe(testContract.description);
            expect(result.discloseErc20TotalSupply).toBe(true);
            expect(result.discloseBytecode).toBe(true);
            expect(result.disclosureStartBlock).toBe('0x0');
            expect(result.disclosedAddresses).toHaveLength(2);
            expect(result.disclosedAddresses[0]?.address.toLowerCase()).toBe(
                '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            );
            expect(result.disclosedAddresses[1]?.address.toLowerCase()).toBe(
                '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
            );
        });

        it('persists disclosureStartBlock when provided', async () => {
            const result = await repository.create({ ...testContract, disclosureStartBlock: '0x3039' });
            expect(result.disclosureStartBlock).toBe('0x3039');
        });

        it('disclosed addresses can exist when disclose total supply is false', async () => {
            const contractWithoutLocks = {
                ...testContract,
                discloseErc20TotalSupply: false // Don't disclose, so no lock addresses
            };

            const result = await repository.create(contractWithoutLocks);

            expect(result.contractAddress).toBe(testContract.contractAddress);
            expect(result.discloseErc20TotalSupply).toBe(false);
            expect(result.disclosedAddresses).toHaveLength(2);
        });

        it('should throw EntityAlreadyExistsError for duplicate address', async () => {
            await repository.create(testContract);
            await expect(repository.create(testContract)).rejects.toThrow(EntityAlreadyExistsError);
        });

        it('should throw InvalidInputError for invalid ABI', async () => {
            const invalidContract = {
                ...testContract,
                abi: 'not valid json'
            };

            await expect(repository.create(invalidContract)).rejects.toThrow(InvalidInputError);
        });

        it('should throw InvalidInputError for empty ABI', async () => {
            const emptyAbiContract = {
                ...testContract,
                abi: ''
            };

            await expect(repository.create(emptyAbiContract)).rejects.toThrow();
        });
    });

    describe('findByAddress', () => {
        it('should find an existing contract', async () => {
            await repository.create(testContract);

            const result = await repository.findByAddress(testContract.contractAddress);

            expect(result.contractAddress).toBe(testContract.contractAddress);
            expect(result.name).toBe(testContract.name);
            expect(result.disclosedAddresses).toHaveLength(2);
        });

        it('should throw EntityNotFound for non-existent contract', async () => {
            const nonExistentAddress = '0x9999999999999999999999999999999999999999';

            await expect(repository.findByAddress(nonExistentAddress)).rejects.toThrow(EntityNotFound);
        });
    });

    describe('findGrouped', () => {
        it('should return ungrouped contracts when no templates exist', async () => {
            // Create multiple contracts without templates
            const contracts: ContractCreate[] = [];
            for (let i = 0; i < 5; i++) {
                const address = `0x${i.toString().padStart(40, '0')}`;
                contracts.push({
                    ...testContract,
                    contractAddress: address as Address,
                    name: `Contract ${i}`
                });
            }

            for (const contract of contracts) {
                await repository.create(contract);
            }

            // Get first page - should return ungrouped contracts
            const page1 = await repository.findGrouped({ limit: 2, offset: 0 });
            expect(page1.items).toHaveLength(2);
            expect(page1.totalUngrouped).toBe(5);
            expect(page1.totalGroups).toBe(0);
            // All items should be of type 'contract'
            for (const item of page1.items) {
                expect(item.type).toBe('contract');
            }

            // Get second page
            const page2 = await repository.findGrouped({ limit: 2, offset: 2 });
            expect(page2.items).toHaveLength(2);

            // Get third page
            const page3 = await repository.findGrouped({ limit: 2, offset: 4 });
            expect(page3.items).toHaveLength(1);
        });

        it('should return empty array when no contracts', async () => {
            const result = await repository.findGrouped({ limit: 10, offset: 0 });
            expect(result.items).toHaveLength(0);
            expect(result.totalContracts).toBe(0);
        });

        it('should include lock addresses in ungrouped results', async () => {
            await repository.create(testContract);

            const result = await repository.findGrouped({ limit: 10, offset: 0 });

            expect(result.items).toHaveLength(1);
            const item = result.items[0];
            expect(item?.type).toBe('contract');
            if (item?.type === 'contract') {
                expect(item.disclosedAddresses).toHaveLength(2);
                expect(item.disclosedAddresses[0]?.address.toLowerCase()).toBe(
                    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
                );
            }
        });
    });

    describe('update', () => {
        it('should update all fields of a contract', async () => {
            await repository.create(testContract);

            const updatedData: ContractUpdate = {
                contractAddress: testContract.contractAddress,
                abi: validAbi,
                name: 'Updated Name',
                description: 'Updated description',
                discloseErc20TotalSupply: false,
                discloseBytecode: false,
                disclosureStartBlock: '0x0',
                disclosedAddresses: [{ address: '0xcccccccccccccccccccccccccccccccccccccccc' }]
            };

            const result = await repository.update(testContract.contractAddress, updatedData);

            expect(result.name).toBe('Updated Name');
            expect(result.description).toBe('Updated description');
            expect(result.discloseErc20TotalSupply).toBe(false);
            expect(result.discloseBytecode).toBe(false);
            expect(result.disclosedAddresses).toEqual([
                { address: getAddress('0xcccccccccccccccccccccccccccccccccccccccc') }
            ]);
        });

        it('should replace lock addresses on update', async () => {
            await repository.create(testContract);

            const updatedData: ContractUpdate = {
                ...testContract,
                disclosedAddresses: [
                    { address: '0xdddddddddddddddddddddddddddddddddddddddd' },
                    { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
                    { address: '0xffffffffffffffffffffffffffffffffffffffff' }
                ]
            };

            const result = await repository.update(testContract.contractAddress, updatedData);

            expect(result.disclosedAddresses).toHaveLength(3);
            expect(result.disclosedAddresses[0]?.address.toLowerCase()).toBe(
                '0xdddddddddddddddddddddddddddddddddddddddd'
            );
            expect(result.disclosedAddresses[1]?.address.toLowerCase()).toBe(
                '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
            );
            expect(result.disclosedAddresses[2]?.address.toLowerCase()).toBe(
                '0xffffffffffffffffffffffffffffffffffffffff'
            );
        });

        it('should update the contract address and keep disclosed addresses', async () => {
            await repository.create(testContract);
            const newAddress = '0x2234567890123456789012345678901234567890';

            const result = await repository.update(testContract.contractAddress, {
                ...testContract,
                contractAddress: newAddress
            });

            expect(result.contractAddress).toBe(getAddress(newAddress));
            expect(result.disclosedAddresses).toEqual([
                { address: getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') },
                { address: getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') }
            ]);
            await expect(repository.findByAddress(testContract.contractAddress)).rejects.toThrow(EntityNotFound);

            const refetched = await repository.findByAddress(newAddress);
            expect(refetched.disclosedAddresses.map(({ address }) => ({ address }))).toEqual(result.disclosedAddresses);
        });

        it('clears disclosed addresses when the field is omitted (PUT replace semantics)', async () => {
            await repository.create(testContract);

            const { disclosedAddresses: _omitted, ...withoutDisclosedAddresses } = testContract;
            const result = await repository.update(testContract.contractAddress, withoutDisclosedAddresses);

            expect(result.disclosedAddresses).toEqual([]);

            const refetched = await repository.findByAddress(testContract.contractAddress);
            expect(refetched.disclosedAddresses).toEqual([]);
        });

        it('should throw EntityAlreadyExistsError when updating to an existing contract address', async () => {
            await repository.create(testContract);
            const existingAddress = '0x2234567890123456789012345678901234567890';
            await repository.create({
                ...testContract,
                contractAddress: existingAddress,
                disclosedAddresses: []
            });

            await expect(
                repository.update(testContract.contractAddress, {
                    ...testContract,
                    contractAddress: existingAddress
                })
            ).rejects.toThrow(EntityAlreadyExistsError);
        });

        it('allows a same-address update in different casing without conflicting against itself', async () => {
            const lowerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
            await repository.create({ ...testContract, contractAddress: lowerAddress });

            const upperCaseAddress = `0x${lowerAddress.slice(2).toUpperCase()}` as const;

            // A case-only difference must read as "no address change" (case-insensitive
            // isChangingAddress guard), not trip EntityAlreadyExistsError against itself.
            const result = await repository.update(lowerAddress, {
                ...testContract,
                contractAddress: upperCaseAddress
            });

            expect(result.contractAddress).toBe(getAddress(lowerAddress));
        });

        it('should throw EntityNotFound when updating non-existent contract', async () => {
            const nonExistentAddress = '0x9999999999999999999999999999999999999999';
            await expect(repository.update(nonExistentAddress, testContract)).rejects.toThrow(EntityNotFound);
        });

        it('should throw InvalidInputError for invalid ABI on update', async () => {
            await repository.create(testContract);

            const invalidUpdate = {
                ...testContract,
                abi: 'invalid json'
            };

            await expect(repository.update(testContract.contractAddress, invalidUpdate)).rejects.toThrow(
                InvalidInputError
            );
        });
    });

    describe('delete', () => {
        it('should delete an existing contract', async () => {
            await repository.create(testContract);
            await repository.delete(testContract.contractAddress);
            await expect(repository.findByAddress(testContract.contractAddress)).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound when deleting non-existent contract', async () => {
            const nonExistentAddress = '0x9999999999999999999999999999999999999999';
            await expect(repository.delete(nonExistentAddress)).rejects.toThrow(EntityNotFound);
        });
    });

    describe('getBytecodeDisclosureConfig', () => {
        it('returns the config when bytecode disclosure is enabled', async () => {
            await repository.create({ ...testContract, disclosureStartBlock: '0x2a' });

            const result = await repository.getBytecodeDisclosureConfig(testContract.contractAddress);
            expect(result).toEqual({ disclosureStartBlock: '0x2a' });
        });

        it('returns null when bytecode disclosure is disabled', async () => {
            await repository.create({ ...testContract, discloseBytecode: false });

            const result = await repository.getBytecodeDisclosureConfig(testContract.contractAddress);
            expect(result).toBeNull();
        });

        it('returns null for non-existent contract', async () => {
            const nonExistentAddress = '0x9999999999999999999999999999999999999999';

            const result = await repository.getBytecodeDisclosureConfig(nonExistentAddress);
            expect(result).toBeNull();
        });
    });
});
