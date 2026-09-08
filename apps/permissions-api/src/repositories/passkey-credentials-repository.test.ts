import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { EntityNotFound } from '../utils/error-types';
import { type InsertPasskeyCredential, PasskeyCredentialsRepository } from './passkey-credentials-repository';
import { type User, UsersRepository } from './users-repository';

describe('PasskeyCredentialsRepository', () => {
    let repository: PasskeyCredentialsRepository;
    let usersRepository: UsersRepository;
    let testUser: User;
    let testUser2: User;

    beforeEach<Fixture>(async ({ db }) => {
        vi.useFakeTimers();
        repository = new PasskeyCredentialsRepository(db);
        usersRepository = new UsersRepository(db);

        // Create test users
        testUser = await usersRepository.create({
            displayName: 'Test User',
            source: 'adminPanel'
        });

        testUser2 = await usersRepository.create({
            displayName: 'Test User 2',
            source: 'adminPanel'
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    const createTestCredential = (overrides?: Partial<InsertPasskeyCredential>): InsertPasskeyCredential => ({
        userId: testUser.id,
        credentialId: `cred-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        publicKey: 'test-public-key-base64',
        counter: 0,
        deviceName: 'Test Device',
        transports: ['usb', 'nfc'],
        ...overrides
    });

    describe('create', () => {
        it('creates a passkey credential', async () => {
            const credentialData = createTestCredential();
            const credential = await repository.create(credentialData);

            expect(credential.id).toBeDefined();
            expect(credential.userId).toBe(testUser.id);
            expect(credential.credentialId).toBe(credentialData.credentialId);
            expect(credential.publicKey).toBe(credentialData.publicKey);
            expect(credential.counter).toBe(0);
            expect(credential.deviceName).toBe('Test Device');
            expect(credential.transports).toEqual(['usb', 'nfc']);
            expect(credential.lastUsedAt).toBeNull();
            expect(credential.createdAt).toBeDefined();
            expect(credential.updatedAt).toBeDefined();
        });

        it('creates a credential with null deviceName and transports', async () => {
            const credentialData = createTestCredential({
                deviceName: null,
                transports: null
            });
            const credential = await repository.create(credentialData);

            expect(credential.deviceName).toBeNull();
            expect(credential.transports).toBeNull();
        });
    });

    describe('findById', () => {
        it('returns credential when found', async () => {
            const credentialData = createTestCredential();
            const created = await repository.create(credentialData);

            const found = await repository.findById(created.id);

            expect(found).toBeDefined();
            expect(found?.id).toBe(created.id);
            expect(found?.credentialId).toBe(created.credentialId);
        });

        it('returns undefined when not found', async () => {
            const found = await repository.findById('non-existent-id');
            expect(found).toBeUndefined();
        });
    });

    describe('findByCredentialId', () => {
        it('returns credential when found by WebAuthn credential ID', async () => {
            const credentialData = createTestCredential();
            const created = await repository.create(credentialData);

            const found = await repository.findByCredentialId(credentialData.credentialId);

            expect(found).toBeDefined();
            expect(found?.id).toBe(created.id);
            expect(found?.credentialId).toBe(credentialData.credentialId);
        });

        it('returns undefined when credential ID not found', async () => {
            const found = await repository.findByCredentialId('non-existent-credential-id');
            expect(found).toBeUndefined();
        });
    });

    describe('findByUserId', () => {
        it('returns all credentials for a user', async () => {
            const cred1 = await repository.create(createTestCredential());

            vi.advanceTimersByTime(1000);
            const cred2 = await repository.create(createTestCredential());

            const credentials = await repository.findByUserId(testUser.id);

            expect(credentials).toHaveLength(2);
            // Should be ordered by createdAt desc
            expect(credentials[0]?.id).toBe(cred2.id);
            expect(credentials[1]?.id).toBe(cred1.id);
        });

        it('returns empty array when user has no credentials', async () => {
            const credentials = await repository.findByUserId(testUser.id);
            expect(credentials).toEqual([]);
        });

        it('only returns credentials for specified user', async () => {
            await repository.create(createTestCredential({ userId: testUser.id }));
            await repository.create(createTestCredential({ userId: testUser2.id }));

            const user1Credentials = await repository.findByUserId(testUser.id);
            const user2Credentials = await repository.findByUserId(testUser2.id);

            expect(user1Credentials).toHaveLength(1);
            expect(user2Credentials).toHaveLength(1);
            expect(user1Credentials[0]?.userId).toBe(testUser.id);
            expect(user2Credentials[0]?.userId).toBe(testUser2.id);
        });
    });

    describe('countByUserId', () => {
        it('returns count of credentials for user', async () => {
            await repository.create(createTestCredential());
            await repository.create(createTestCredential());

            const count = await repository.countByUserId(testUser.id);
            expect(count).toBe(2);
        });

        it('returns 0 when user has no credentials', async () => {
            const count = await repository.countByUserId(testUser.id);
            expect(count).toBe(0);
        });
    });

    describe('update', () => {
        it('updates the counter value', async () => {
            const created = await repository.create(createTestCredential());
            expect(created.counter).toBe(0);

            const updated = await repository.updateById(created.id, { counter: 5 });

            expect(updated.counter).toBe(5);

            // Verify persistence
            const found = await repository.findById(created.id);
            expect(found?.counter).toBe(5);
        });

        it('updates the lastUsedAt timestamp', async () => {
            const created = await repository.create(createTestCredential());
            expect(created.lastUsedAt).toBeNull();

            const now = new Date(2025, 1, 1);
            vi.setSystemTime(now);

            const updated = await repository.updateById(created.id, { lastUsedAt: now });

            expect(updated.lastUsedAt).toEqual(now);

            // Verify persistence
            const found = await repository.findById(created.id);
            expect(found?.lastUsedAt).toEqual(now);
        });

        it('throws EntityNotFound when credential does not exist', async () => {
            await expect(repository.updateById('non-existent-id', { counter: 1 })).rejects.toThrow(
                new EntityNotFound('PasskeyCredential', { id: 'non-existent-id' })
            );
        });

        it('updates the deviceName', async () => {
            const created = await repository.create(createTestCredential());
            expect(created.deviceName).toBe('Test Device');

            const updated = await repository.updateById(created.id, { deviceName: 'New Device' });

            expect(updated.deviceName).toBe('New Device');

            // Verify persistence
            const found = await repository.findById(created.id);
            expect(found?.deviceName).toBe('New Device');
        });

        it('updates multiple fields at once', async () => {
            const created = await repository.create(createTestCredential());
            const now = new Date();
            vi.setSystemTime(now);

            const updated = await repository.updateById(created.id, {
                deviceName: 'Updated Device',
                counter: 10,
                lastUsedAt: now
            });

            expect(updated.deviceName).toBe('Updated Device');
            expect(updated.counter).toBe(10);
            expect(updated.lastUsedAt).toEqual(now);

            // Verify persistence
            const found = await repository.findById(created.id);
            expect(found?.deviceName).toBe('Updated Device');
            expect(found?.counter).toBe(10);
            expect(found?.lastUsedAt).toEqual(now);
        });
    });

    describe('delete', () => {
        it('deletes the credential', async () => {
            const created = await repository.create(createTestCredential());

            await repository.deleteById(created.id);

            const found = await repository.findById(created.id);
            expect(found).toBeUndefined();
        });

        it('throws EntityNotFound when credential does not exist', async () => {
            await expect(repository.deleteById('non-existent-id')).rejects.toThrow(
                new EntityNotFound('PasskeyCredential', { id: 'non-existent-id' })
            );
        });
    });

    describe('deleteIfNotLast', () => {
        it('deletes when another credential exists for the user', async () => {
            const c1 = await repository.create(createTestCredential());
            await repository.create(createTestCredential());

            const result = await repository.deleteIfNotLast(c1.id, testUser.id);

            expect(result).toBe('deleted');
            expect(await repository.findById(c1.id)).toBeUndefined();
            expect(await repository.countByUserId(testUser.id)).toBe(1);
        });

        it('returns "last" when the credential is the only one', async () => {
            const c1 = await repository.create(createTestCredential());

            const result = await repository.deleteIfNotLast(c1.id, testUser.id);

            expect(result).toBe('last');
            expect(await repository.findById(c1.id)).toBeDefined();
            expect(await repository.countByUserId(testUser.id)).toBe(1);
        });

        it('returns "not_found" when the credential does not exist', async () => {
            const result = await repository.deleteIfNotLast('non-existent-id', testUser.id);
            expect(result).toBe('not_found');
        });

        it('returns "not_found" when the credential belongs to a different user', async () => {
            const other = await repository.create(createTestCredential({ userId: testUser2.id }));

            const result = await repository.deleteIfNotLast(other.id, testUser.id);

            expect(result).toBe('not_found');
            expect(await repository.findById(other.id)).toBeDefined();
        });

        it('prevents concurrent deletes from dropping below one (atomicity)', async () => {
            const c1 = await repository.create(createTestCredential());
            const c2 = await repository.create(createTestCredential());

            const [r1, r2] = await Promise.all([
                repository.deleteIfNotLast(c1.id, testUser.id),
                repository.deleteIfNotLast(c2.id, testUser.id)
            ]);

            const outcomes = [r1, r2].sort();
            expect(outcomes).toEqual(['deleted', 'last']);

            const remaining = await repository.countByUserId(testUser.id);
            expect(remaining).toBe(1);
        });
    });

    describe('deleteAllByUserId', () => {
        it('deletes all credentials for a user', async () => {
            await repository.create(createTestCredential({ userId: testUser.id }));
            await repository.create(createTestCredential({ userId: testUser.id }));
            await repository.create(createTestCredential({ userId: testUser2.id }));

            const deletedCount = await repository.deleteAllByUserId(testUser.id);

            expect(deletedCount).toBe(2);

            const user1Credentials = await repository.findByUserId(testUser.id);
            expect(user1Credentials).toHaveLength(0);

            // User 2's credentials should still exist
            const user2Credentials = await repository.findByUserId(testUser2.id);
            expect(user2Credentials).toHaveLength(1);
        });

        it('returns 0 when user has no credentials', async () => {
            const deletedCount = await repository.deleteAllByUserId(testUser.id);
            expect(deletedCount).toBe(0);
        });
    });

    describe('cascade delete', () => {
        it('deletes credentials when user is deleted', async () => {
            const credential = await repository.create(createTestCredential());

            // Delete the user
            await usersRepository.delete(testUser.id);

            // Credential should be deleted due to cascade
            const found = await repository.findById(credential.id);
            expect(found).toBeUndefined();
        });
    });
});
