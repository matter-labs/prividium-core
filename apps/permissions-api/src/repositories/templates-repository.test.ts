import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError } from '../utils/error-types';
import { type InsertTemplate, TemplatesRepository, type UpdateTemplate } from './templates-repository';

describe('TemplatesRepository', () => {
    let repository: TemplatesRepository;
    const validAbi = JSON.stringify([
        {
            inputs: [],
            name: 'totalSupply',
            outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function'
        },
        {
            inputs: [
                { internalType: 'address', name: 'to', type: 'address' },
                { internalType: 'uint256', name: 'amount', type: 'uint256' }
            ],
            name: 'transfer',
            outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
            stateMutability: 'nonpayable',
            type: 'function'
        }
    ]);

    const testTemplate: InsertTemplate = {
        templateKey: 'erc20',
        name: 'ERC20 Token',
        description: 'Standard ERC20 token template',
        abi: validAbi
    };

    beforeEach<Fixture>(async ({ db }) => {
        repository = new TemplatesRepository(db);
    });

    describe('create', () => {
        it('should create a template with all fields', async () => {
            const result = await repository.create(testTemplate);

            expect(result.templateKey).toBe(testTemplate.templateKey);
            expect(result.name).toBe(testTemplate.name);
            expect(result.description).toBe(testTemplate.description);
            expect(result.abi).toBe(testTemplate.abi);
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.updatedAt).toBeInstanceOf(Date);
        });

        it('should create a template with null description', async () => {
            const templateWithNullDesc = {
                ...testTemplate,
                templateKey: 'erc721',
                description: null
            };

            const result = await repository.create(templateWithNullDesc);

            expect(result.templateKey).toBe('erc721');
            expect(result.description).toBeNull();
        });

        it('should throw EntityAlreadyExistsError for duplicate templateKey', async () => {
            await repository.create(testTemplate);
            await expect(repository.create(testTemplate)).rejects.toThrow(EntityAlreadyExistsError);
        });

        it('should throw InvalidInputError for invalid ABI (not JSON)', async () => {
            const invalidTemplate = {
                ...testTemplate,
                templateKey: 'invalid',
                abi: 'not valid json'
            };

            await expect(repository.create(invalidTemplate)).rejects.toThrow(InvalidInputError);
        });

        it('should throw InvalidInputError for invalid ABI structure', async () => {
            const invalidTemplate = {
                ...testTemplate,
                templateKey: 'invalid',
                abi: JSON.stringify({ invalid: 'structure' })
            };

            await expect(repository.create(invalidTemplate)).rejects.toThrow(InvalidInputError);
        });

        it('should allow template keys with lowercase, numbers, hyphens, and underscores', async () => {
            const validKeys = ['erc20', 'erc-721', 'erc_1155', 'custom-token-123'];

            for (const key of validKeys) {
                const template = {
                    ...testTemplate,
                    templateKey: key
                };
                const result = await repository.create(template);
                expect(result.templateKey).toBe(key);
            }
        });
    });

    describe('getByKey', () => {
        it('should find an existing template', async () => {
            await repository.create(testTemplate);

            const result = await repository.getByKey(testTemplate.templateKey);

            expect(result.templateKey).toBe(testTemplate.templateKey);
            expect(result.name).toBe(testTemplate.name);
            expect(result.abi).toBe(testTemplate.abi);
        });

        it('should throw EntityNotFound for non-existent template', async () => {
            await expect(repository.getByKey('nonexistent')).rejects.toThrow(EntityNotFound);
        });
    });

    describe('findPaginated', () => {
        it('should return paginated results', async () => {
            // Create multiple templates
            const templates: InsertTemplate[] = [];
            for (let i = 0; i < 5; i++) {
                templates.push({
                    ...testTemplate,
                    templateKey: `template-${i}`,
                    name: `Template ${i}`
                });
            }

            for (const template of templates) {
                await repository.create(template);
            }

            // Get first page
            const page1 = await repository.findPaginated({ limit: 2, offset: 0 });
            expect(page1.items).toHaveLength(2);

            // Get second page
            const page2 = await repository.findPaginated({ limit: 2, offset: 2 });
            expect(page2.items).toHaveLength(2);

            // Get third page
            const page3 = await repository.findPaginated({ limit: 2, offset: 4 });
            expect(page3.items).toHaveLength(1);
        });

        it('should return empty array when no templates', async () => {
            const result = await repository.findPaginated({ limit: 10, offset: 0 });
            expect(result.items).toHaveLength(0);
            expect(result.pagination.totalItems).toBe(0);
        });

        it('filters by searchQuery (case-insensitive substring on key, name, or description)', async () => {
            await repository.create({ ...testTemplate, templateKey: 'erc20-eu', name: 'Trader EU' });
            await repository.create({ ...testTemplate, templateKey: 'erc20-us', name: 'TRADER US' });
            await repository.create({
                ...testTemplate,
                templateKey: 'auditor',
                name: 'Auditor',
                description: 'trader-focused audits'
            });
            await repository.create({ ...testTemplate, templateKey: 'unrelated', name: 'Other' });

            const result = await repository.findPaginated({ limit: 10, offset: 0, searchQuery: 'trader' });

            const keys = result.items.map((t) => t.templateKey).sort();
            expect(keys).toEqual(['auditor', 'erc20-eu', 'erc20-us']);
            expect(result.pagination.totalItems).toBe(3);
        });

        it('treats LIKE wildcards in searchQuery literally', async () => {
            await repository.create({ ...testTemplate, templateKey: 'erc20_base', name: 'Base', description: null });
            await repository.create({ ...testTemplate, templateKey: 'erc20xbase', name: 'Other', description: null });

            // `_` is a single-char wildcard in ILIKE; without escaping `erc20_` would also match `erc20xbase`.
            const result = await repository.findPaginated({ limit: 10, offset: 0, searchQuery: 'erc20_' });

            expect(result.items.map((t) => t.templateKey)).toEqual(['erc20_base']);
            expect(result.pagination.totalItems).toBe(1);
        });

        it('returns templates ordered by name across pages', async () => {
            // Created out of alphabetical order to prove the ordering is server-side, not insertion order.
            await repository.create({ ...testTemplate, templateKey: 'charlie', name: 'Charlie' });
            await repository.create({ ...testTemplate, templateKey: 'alpha', name: 'Alpha' });
            await repository.create({ ...testTemplate, templateKey: 'bravo', name: 'Bravo' });

            const page1 = await repository.findPaginated({ limit: 2, offset: 0 });
            const page2 = await repository.findPaginated({ limit: 2, offset: 2 });

            expect(page1.items.map((t) => t.name)).toEqual(['Alpha', 'Bravo']);
            expect(page2.items.map((t) => t.name)).toEqual(['Charlie']);
        });
    });

    describe('update', () => {
        it('should update all fields of a template', async () => {
            const updatedAbi = JSON.stringify([
                {
                    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
                    name: 'ownerOf',
                    outputs: [{ internalType: 'address', name: '', type: 'address' }],
                    stateMutability: 'view',
                    type: 'function'
                }
            ]);

            const updatedData: UpdateTemplate = {
                name: 'Updated Name',
                description: 'Updated description',
                abi: updatedAbi
            };

            const createdTemplate = await repository.create(testTemplate);
            const result = await repository.updateById(createdTemplate.id, updatedData);

            expect(result.name).toBe('Updated Name');
            expect(result.description).toBe('Updated description');
            expect(result.abi).toBe(updatedAbi);
            expect(result.templateKey).toBe(testTemplate.templateKey);
        });

        it('should throw EntityNotFound when updating non-existent template', async () => {
            const updateData: UpdateTemplate = {
                name: testTemplate.name,
                description: testTemplate.description,
                abi: testTemplate.abi
            };
            await expect(repository.updateById(999999, updateData)).rejects.toThrow(EntityNotFound);
        });

        it('should throw InvalidInputError for invalid ABI on update', async () => {
            const createdTemplate = await repository.create(testTemplate);

            const invalidUpdate: UpdateTemplate = {
                name: testTemplate.name,
                description: testTemplate.description,
                abi: 'invalid json'
            };

            await expect(repository.updateById(createdTemplate.id, invalidUpdate)).rejects.toThrow(InvalidInputError);
        });

        it('should update template with null description', async () => {
            const createdTemplate = await repository.create(testTemplate);

            const updatedData: UpdateTemplate = {
                name: testTemplate.name,
                description: null,
                abi: testTemplate.abi
            };

            const result = await repository.updateById(createdTemplate.id, updatedData);

            expect(result.description).toBeNull();
        });
    });

    describe('delete', () => {
        it('should delete an existing template', async () => {
            const createdTemplate = await repository.create(testTemplate);
            await repository.deleteById(createdTemplate.id);
            await expect(repository.getByKey(testTemplate.templateKey)).rejects.toThrow(EntityNotFound);
        });

        it('should throw EntityNotFound when deleting non-existent template', async () => {
            await expect(repository.deleteById(999999)).rejects.toThrow(EntityNotFound);
        });

        it('should allow creating a template with the same key after deletion', async () => {
            const createdTemplate = await repository.create(testTemplate);
            await repository.deleteById(createdTemplate.id);

            // Should be able to create again
            const result = await repository.create(testTemplate);
            expect(result.templateKey).toBe(testTemplate.templateKey);
        });
    });
});
