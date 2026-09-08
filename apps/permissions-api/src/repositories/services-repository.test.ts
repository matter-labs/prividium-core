import { pad, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { EntityNotFound } from '../utils/error-types';
import { ServicesRepository } from './services-repository';

// These tests exercise the production ServicesRepository end-to-end to confirm the
// EntityRepository refactor preserves its behaviour. They overlap with the generic
// entity-repository.test.ts coverage on purpose and should be removed alongside the
// Service/Tenant entities when those are retired.
describe('ServicesRepository', () => {
    let repository: ServicesRepository;

    const privateKey = generatePrivateKey();
    const address = privateKeyToAddress(privateKey);

    beforeEach<Fixture>(async ({ db }) => {
        repository = new ServicesRepository(db);
    });

    describe('create', () => {
        it('creates a basic service', async () => {
            const name = 'Test Service';

            const service = await repository.create({
                name,
                publicKey: address
            });

            expect(service.id).toHaveLength(21);
            expect(service.name).toEqual(name);
            expect(service.publicKey).toEqual(address);
            expect(service.description).toBeNull();
            expect(service.createdAt).toBeInstanceOf(Date);
            expect(service.updatedAt).toBeInstanceOf(Date);
        });

        it('creates a service with description', async () => {
            const name = 'Service With Description';
            const description = 'This is a test service';

            const service = await repository.create({
                name,
                publicKey: address,
                description
            });

            expect(service.name).toEqual(name);
            expect(service.description).toEqual(description);
        });

        it('creates services with unique public keys', async () => {
            const address1 = privateKeyToAddress(generatePrivateKey());
            const address2 = privateKeyToAddress(generatePrivateKey());

            const service1 = await repository.create({ name: 'Service 1', publicKey: address1 });
            const service2 = await repository.create({ name: 'Service 2', publicKey: address2 });

            expect(service1.publicKey).toEqual(address1);
            expect(service2.publicKey).toEqual(address2);
            expect(service1.id).not.toEqual(service2.id);
        });
    });

    describe('findById / getById', () => {
        it('findById returns undefined when id does not exist', async () => {
            expect(await repository.findById('doesnotexist')).toBeUndefined();
        });

        it('getById throws when id does not exist', async () => {
            await expect(repository.getById('doesnotexist')).rejects.toThrow(EntityNotFound);
        });

        it('returns all data when id exists', async () => {
            const created = await repository.create({
                name: 'Test Service',
                publicKey: address,
                description: 'A description'
            });

            const retrieved = await repository.getById(created.id);

            expect(retrieved.id).toEqual(created.id);
            expect(retrieved.name).toEqual(created.name);
            expect(retrieved.publicKey).toEqual(address);
            expect(retrieved.description).toEqual('A description');
            expect(retrieved.createdAt).toEqual(created.createdAt);
            expect(retrieved.updatedAt).toEqual(created.updatedAt);
        });
    });

    describe('findByPublicKey', () => {
        it('returns undefined when public key does not exist', async () => {
            const result = await repository.findByPublicKey(address);
            expect(result).toBeUndefined();
        });

        it('returns service when public key exists', async () => {
            const created = await repository.create({
                name: 'Test Service',
                publicKey: address
            });

            const retrieved = await repository.findByPublicKey(address);

            expect(retrieved).toBeDefined();
            expect(retrieved!.id).toEqual(created.id);
            expect(retrieved!.name).toEqual(created.name);
            expect(retrieved!.publicKey).toEqual(address);
        });
    });

    describe('findPaginated', () => {
        it('returns empty list when no services created', async () => {
            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            expect(result).toEqual({
                items: [],
                pagination: {
                    currentPage: 1,
                    limit: 10,
                    offset: 0,
                    totalItems: 0,
                    totalPages: 0
                }
            });
        });

        it('returns all data for existing services', async () => {
            const service1 = await repository.create({ name: 'Service 1', publicKey: address });

            const address2 = privateKeyToAddress(generatePrivateKey());
            const service2 = await repository.create({ name: 'Service 2', publicKey: address2 });

            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            expect(result.pagination).toEqual({
                currentPage: 1,
                limit: 10,
                offset: 0,
                totalItems: 2,
                totalPages: 1
            });
            expect(result.items).toContainEqual(service1);
            expect(result.items).toContainEqual(service2);
            expect(result.items).toHaveLength(2);
        });

        it('returns results ordered by creation date', async () => {
            for (let i = 0; i < 11; i++) {
                await repository.create({
                    name: `Service-${i}`,
                    publicKey: pad(toHex(i), { size: 20 })
                });
            }

            const result = await repository.findPaginated({ limit: 10, offset: 0 });

            expect(result.pagination).toEqual({
                currentPage: 1,
                limit: 10,
                offset: 0,
                totalItems: 11,
                totalPages: 2
            });
            expect(result.items).toHaveLength(10);
            expect(result.items.map((i) => i.name)).toEqual([
                'Service-0',
                'Service-1',
                'Service-2',
                'Service-3',
                'Service-4',
                'Service-5',
                'Service-6',
                'Service-7',
                'Service-8',
                'Service-9'
            ]);
        });

        it('respects offset for pagination', async () => {
            for (let i = 0; i < 5; i++) {
                await repository.create({
                    name: `Service-${i}`,
                    publicKey: pad(toHex(i), { size: 20 })
                });
            }

            const result = await repository.findPaginated({ limit: 2, offset: 2 });

            expect(result.pagination).toEqual({
                currentPage: 2,
                limit: 2,
                offset: 2,
                totalItems: 5,
                totalPages: 3
            });
            expect(result.items).toHaveLength(2);
            expect(result.items.map((i) => i.name)).toEqual(['Service-2', 'Service-3']);
        });
    });

    describe('update', () => {
        it('updates name field', async () => {
            const created = await repository.create({
                name: 'Original Name',
                publicKey: address
            });

            const updated = await repository.updateById(created.id, { ...created, name: 'New Name' });

            expect(updated.name).toEqual('New Name');
            expect(updated.publicKey).toEqual(address);

            const retrieved = await repository.getById(created.id);
            expect(retrieved.name).toEqual('New Name');
        });

        it('updates description field', async () => {
            const created = await repository.create({
                name: 'Test Service',
                publicKey: address
            });

            const updated = await repository.updateById(created.id, { ...created, description: 'New description' });

            expect(updated.description).toEqual('New description');

            const retrieved = await repository.getById(created.id);
            expect(retrieved.description).toEqual('New description');
        });

        it('updates publicKey field', async () => {
            const created = await repository.create({
                name: 'Test Service',
                publicKey: address
            });

            const newAddress = privateKeyToAddress(generatePrivateKey());
            const updated = await repository.updateById(created.id, { ...created, publicKey: newAddress });

            expect(updated.publicKey).toEqual(newAddress);

            const retrieved = await repository.getById(created.id);
            expect(retrieved.publicKey).toEqual(newAddress);
        });

        it('updates multiple fields at once', async () => {
            const created = await repository.create({
                name: 'Original Name',
                publicKey: address
            });

            const newAddress = privateKeyToAddress(generatePrivateKey());
            const updated = await repository.updateById(created.id, {
                ...created,
                name: 'Updated Name',
                publicKey: newAddress,
                description: 'Added description'
            });

            expect(updated.name).toEqual('Updated Name');
            expect(updated.publicKey).toEqual(newAddress);
            expect(updated.description).toEqual('Added description');
        });

        it('throws if service does not exist', async () => {
            const created = await repository.create({ name: 'Test Service', publicKey: address });

            await expect(repository.updateById('doesnotexist', { ...created, name: 'New Name' })).rejects.toThrow(
                EntityNotFound
            );
        });
    });

    describe('delete', () => {
        it('can delete an existing service', async () => {
            const created = await repository.create({
                name: 'To Be Deleted',
                publicKey: address
            });

            await repository.deleteById(created.id);

            await expect(repository.getById(created.id)).rejects.toThrow(EntityNotFound);
        });

        it('throws if service does not exist', async () => {
            await expect(repository.deleteById('doesnotexist')).rejects.toThrow(EntityNotFound);
        });

        it('deleting one service does not affect others', async () => {
            const service1 = await repository.create({ name: 'Service 1', publicKey: address });

            const address2 = privateKeyToAddress(generatePrivateKey());
            const service2 = await repository.create({ name: 'Service 2', publicKey: address2 });

            await repository.deleteById(service1.id);

            await expect(repository.getById(service1.id)).rejects.toThrow(EntityNotFound);

            const retrieved = await repository.getById(service2.id);
            expect(retrieved).toEqual(service2);
        });
    });
});
