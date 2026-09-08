import { addDays, addHours, addMinutes, subSeconds } from 'date-fns';
import { sql } from 'drizzle-orm';
import type { Address } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { sessionsTable } from '../db/schema';
import { SessionsRepository } from './sessions-repository';
import { type User, UsersRepository } from './users-repository';

describe('SessionsRepository', () => {
    let repository: SessionsRepository;
    let usersRepository: UsersRepository;
    let testUser: User;
    const testAddress = '0x1234567890123456789012345678901234567890' as Address;

    beforeEach<Fixture>(async ({ db }) => {
        usersRepository = new UsersRepository(db);

        testUser = await usersRepository.create({
            displayName: 'Test User',
            oidcSub: 'oidc-sub-123',
            wallets: [testAddress],
            source: 'adminPanel'
        });

        repository = new SessionsRepository(db);
    });

    describe('create', () => {
        it('should create a session for a user', async () => {
            const tokenHash = 'test-session-token-hash-123';
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

            const session = await repository.create({
                tokenHash,
                expiresAt,
                userId: testUser.id,
                ipAddress: '192.168.1.1',
                userAgent: 'Mozilla/5.0 Test Browser'
            });

            expect(session.id).toBeDefined();
            expect(session.tokenHash).toBe(tokenHash);
            expect(session.userId).toBe(testUser.id);
            expect(session.tenantId).toBeNull();
            expect(session.ipAddress).toBe('192.168.1.1');
            expect(session.userAgent).toBe('Mozilla/5.0 Test Browser');
            expect(session.expiresAt).toEqual(expiresAt);
            expect(session.createdAt).toBeDefined();
            expect(session.updatedAt).toBeDefined();
        });

        it('should create a session without optional fields', async () => {
            const tokenHash = 'test-session-token-hash-456';
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const session = await repository.create({
                tokenHash,
                expiresAt,
                userId: testUser.id
            });

            expect(session.id).toBeDefined();
            expect(session.tokenHash).toBe(tokenHash);
            expect(session.userId).toBe(testUser.id);
            expect(session.ipAddress).toBeNull();
            expect(session.userAgent).toBeNull();
            expect(session.renewableUntil).toBeNull();
        });

        it('should create multiple sessions for the same user', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const session1 = await repository.create({
                tokenHash: 'hash-1',
                expiresAt,
                userId: testUser.id
            });

            const session2 = await repository.create({
                tokenHash: 'hash-2',
                expiresAt,
                userId: testUser.id
            });

            expect(session1.id).not.toBe(session2.id);
            expect(session1.tokenHash).toBe('hash-1');
            expect(session2.tokenHash).toBe('hash-2');
            expect(session1.userId).toBe(testUser.id);
            expect(session2.userId).toBe(testUser.id);
        });

        it('should throw error when creating session with duplicate token hash', async () => {
            const tokenHash = 'duplicate-hash';
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tokenHash,
                expiresAt,
                userId: testUser.id
            });

            // Attempting to create another session with the same token hash should fail
            await expect(
                repository.create({
                    tokenHash,
                    expiresAt,
                    userId: testUser.id
                })
            ).rejects.toThrow();
        });
    });

    describe('findActiveByTokenHash', () => {
        it('should find an active session by token hash', async () => {
            const tokenHash = 'active-hash';
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

            await repository.create({
                tokenHash,
                expiresAt,
                userId: testUser.id,
                ipAddress: '10.0.0.1',
                userAgent: 'Test Agent'
            });

            const foundSession = await repository.findActiveByTokenHash(tokenHash);

            expect(foundSession).toBeDefined();
            expect(foundSession?.tokenHash).toBe(tokenHash);
            expect(foundSession?.userId).toBe(testUser.id);
            expect(foundSession?.ipAddress).toBe('10.0.0.1');
            expect(foundSession?.userAgent).toBe('Test Agent');
        });

        it('should return undefined for non-existent token hash', async () => {
            const result = await repository.findActiveByTokenHash('non-existent-hash');
            expect(result).toBeUndefined();
        });

        it('should not find expired session', async () => {
            const tokenHash = 'expired-hash';
            const expiresAt = new Date(Date.now() - 1000 * 60 * 60 * 24); // Expired 1 day ago

            await repository.create({
                tokenHash,
                expiresAt,
                userId: testUser.id
            });

            const foundSession = await repository.findActiveByTokenHash(tokenHash);

            expect(foundSession).toBeUndefined();
        });

        it('should not find revoked sessions', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const session = await repository.create({ tokenHash: 'revoked-hash', expiresAt, userId: testUser.id });

            // Revoke the session
            await repository.revokeById(session.id, testUser.id);

            const foundSession = await repository.findActiveByTokenHash('revoked-hash');
            expect(foundSession).toBeUndefined();
        });

        it('should find session that expires today but in the future', async () => {
            const tokenHash = 'future-hash';
            const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // Expires in 1 day

            await repository.create({
                tokenHash,
                expiresAt,
                userId: testUser.id
            });

            const foundSession = await repository.findActiveByTokenHash(tokenHash);

            expect(foundSession).toBeDefined();
            expect(foundSession?.tokenHash).toBe(tokenHash);
        });

        it('should only find the requested token hash among multiple sessions', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tokenHash: 'hash-1',
                expiresAt,
                userId: testUser.id
            });

            await repository.create({
                tokenHash: 'hash-2',
                expiresAt,
                userId: testUser.id
            });

            const foundSession = await repository.findActiveByTokenHash('hash-2');

            expect(foundSession).toBeDefined();
            expect(foundSession?.tokenHash).toBe('hash-2');
        });
    });

    describe('deleteByTokenHash', () => {
        it('should delete a session by token hash', async () => {
            const tokenHash = 'hash-to-delete';
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tokenHash,
                expiresAt,
                userId: testUser.id
            });

            // Verify session exists
            let foundSession = await repository.findActiveByTokenHash(tokenHash);
            expect(foundSession).toBeDefined();

            // Delete the session
            await repository.deleteByTokenHash(tokenHash);

            // Verify session no longer exists
            foundSession = await repository.findActiveByTokenHash(tokenHash);
            expect(foundSession).toBeUndefined();
        });

        it('should not throw error when deleting non-existent token hash', async () => {
            await expect(repository.deleteByTokenHash('non-existent-hash')).resolves.not.toThrow();
        });

        it('should only delete the specified token hash', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({
                tokenHash: 'hash-keep',
                expiresAt,
                userId: testUser.id
            });

            await repository.create({
                tokenHash: 'hash-delete',
                expiresAt,
                userId: testUser.id
            });

            await repository.deleteByTokenHash('hash-delete');

            const deletedSession = await repository.findActiveByTokenHash('hash-delete');
            const keptSession = await repository.findActiveByTokenHash('hash-keep');

            expect(deletedSession).toBeUndefined();
            expect(keptSession).toBeDefined();
            expect(keptSession?.tokenHash).toBe('hash-keep');
        });

        it('should delete expired sessions', async ({ db }) => {
            const tokenHash = 'expired-hash';
            const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // Expired yesterday

            await repository.create({
                tokenHash,
                expiresAt,
                userId: testUser.id
            });

            await repository.deleteByTokenHash(tokenHash);

            // Verify deletion by querying the database directly
            const sessions = await db.query.sessionsTable.findMany({
                where: (sessions, { eq }) => eq(sessions.tokenHash, tokenHash)
            });

            expect(sessions).toHaveLength(0);
        });
    });

    describe('findActiveByUserId', () => {
        it('should find all active sessions for a user', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({ tokenHash: 'hash-1', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'hash-2', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'hash-3', expiresAt, userId: testUser.id });

            const sessions = await repository.findActiveByUserId(testUser.id);

            expect(sessions).toHaveLength(3);
            expect(sessions.map((s) => s.tokenHash)).toEqual(expect.arrayContaining(['hash-1', 'hash-2', 'hash-3']));
        });

        it('should return empty array for user with no sessions', async () => {
            const sessions = await repository.findActiveByUserId(testUser.id);
            expect(sessions).toHaveLength(0);
        });

        it('should not return expired sessions', async () => {
            const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000);

            await repository.create({ tokenHash: 'active-hash', expiresAt: futureExpiry, userId: testUser.id });
            await repository.create({ tokenHash: 'expired-hash', expiresAt: pastExpiry, userId: testUser.id });

            const sessions = await repository.findActiveByUserId(testUser.id);

            expect(sessions).toHaveLength(1);
            expect(sessions[0]?.tokenHash).toBe('active-hash');
        });

        it('should not return revoked sessions', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const session1 = await repository.create({ tokenHash: 'hash-1', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'hash-2', expiresAt, userId: testUser.id });

            // Revoke one session
            await repository.revokeById(session1.id, testUser.id);

            const sessions = await repository.findActiveByUserId(testUser.id);

            expect(sessions).toHaveLength(1);
            expect(sessions[0]?.tokenHash).toBe('hash-2');
        });

        it('should order sessions by creation date descending', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            // Create sessions in order
            await repository.create({ tokenHash: 'oldest', expiresAt, userId: testUser.id });
            await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
            await repository.create({ tokenHash: 'middle', expiresAt, userId: testUser.id });
            await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
            await repository.create({ tokenHash: 'newest', expiresAt, userId: testUser.id });

            const sessions = await repository.findActiveByUserId(testUser.id);

            expect(sessions).toHaveLength(3);
            expect(sessions[0]?.tokenHash).toBe('newest');
            expect(sessions[2]?.tokenHash).toBe('oldest');
        });

        it('should only return sessions for the specified user', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            // Create another user
            const otherUser = await usersRepository.create({
                displayName: 'Other User',
                oidcSub: 'oidc-sub-456',
                wallets: [],
                source: 'adminPanel'
            });

            await repository.create({ tokenHash: 'user1-hash', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'user2-hash', expiresAt, userId: otherUser.id });

            const sessions = await repository.findActiveByUserId(testUser.id);

            expect(sessions).toHaveLength(1);
            expect(sessions[0]?.tokenHash).toBe('user1-hash');
        });
    });

    describe('revokeById', () => {
        it('should revoke a session by ID', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const session = await repository.create({ tokenHash: 'hash-to-revoke', expiresAt, userId: testUser.id });

            await repository.revokeById(session.id, testUser.id);

            const foundSession = await repository.findActiveByTokenHash('hash-to-revoke');
            expect(foundSession).toBeUndefined();
        });

        it('should set revokedBy and revokedAt fields', async ({ db }) => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const session = await repository.create({ tokenHash: 'hash-to-revoke', expiresAt, userId: testUser.id });

            const beforeRevoke = new Date();
            await repository.revokeById(session.id, testUser.id);

            // Query directly from database to see revoked fields
            const revokedSession = await db.query.sessionsTable.findFirst({
                where: (sessions, { eq }) => eq(sessions.id, session.id)
            });

            expect(revokedSession?.revokedBy).toBe(testUser.id);
            expect(revokedSession?.revokedAt).toBeDefined();
            expect(revokedSession!.revokedAt!.getTime()).toBeGreaterThanOrEqual(beforeRevoke.getTime());
        });

        it('should not affect other sessions', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const session1 = await repository.create({ tokenHash: 'hash-1', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'hash-2', expiresAt, userId: testUser.id });

            await repository.revokeById(session1.id, testUser.id);

            const activeSession = await repository.findActiveByTokenHash('hash-2');
            expect(activeSession).toBeDefined();
            expect(activeSession?.tokenHash).toBe('hash-2');
        });
    });

    describe('findById', () => {
        it('should find a session by ID', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const session = await repository.create({
                tokenHash: 'find-by-id-hash',
                expiresAt,
                userId: testUser.id
            });

            const foundSession = await repository.findById(session.id);

            expect(foundSession).toBeDefined();
            expect(foundSession?.id).toBe(session.id);
            expect(foundSession?.tokenHash).toBe('find-by-id-hash');
        });

        it('should return undefined for non-existent ID', async () => {
            const result = await repository.findById(99999);
            expect(result).toBeUndefined();
        });

        it('should find revoked sessions (findById does not filter by status)', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const session = await repository.create({
                tokenHash: 'revoked-find-hash',
                expiresAt,
                userId: testUser.id
            });

            await repository.revokeById(session.id, testUser.id);

            const foundSession = await repository.findById(session.id);
            expect(foundSession).toBeDefined();
            expect(foundSession?.revokedAt).toBeDefined();
        });

        it('should find expired sessions (findById does not filter by expiration)', async () => {
            const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // Expired
            const session = await repository.create({
                tokenHash: 'expired-find-hash',
                expiresAt,
                userId: testUser.id
            });

            const foundSession = await repository.findById(session.id);
            expect(foundSession).toBeDefined();
        });
    });

    describe('revokeAllByUserId', () => {
        it('should revoke all sessions for a user', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({ tokenHash: 'hash-1', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'hash-2', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'hash-3', expiresAt, userId: testUser.id });

            const count = await repository.revokeAllByUserId(testUser.id, testUser.id);

            expect(count).toBe(3);

            const activeSessions = await repository.findActiveByUserId(testUser.id);
            expect(activeSessions).toHaveLength(0);
        });

        it('should return 0 when user has no sessions', async () => {
            const count = await repository.revokeAllByUserId(testUser.id, testUser.id);

            expect(count).toBe(0);
        });

        it('should set revokedBy and revokedAt fields for all sessions', async ({ db }) => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const adminUser = await usersRepository.create({
                displayName: 'Admin User',
                oidcSub: 'admin-sub-123',
                wallets: [],
                source: 'adminPanel'
            });

            const session1 = await repository.create({ tokenHash: 'hash-1', expiresAt, userId: testUser.id });
            const session2 = await repository.create({ tokenHash: 'hash-2', expiresAt, userId: testUser.id });

            const beforeRevoke = new Date();
            await repository.revokeAllByUserId(testUser.id, adminUser.id);

            const revokedSession1 = await db.query.sessionsTable.findFirst({
                where: (sessions, { eq }) => eq(sessions.id, session1.id)
            });
            const revokedSession2 = await db.query.sessionsTable.findFirst({
                where: (sessions, { eq }) => eq(sessions.id, session2.id)
            });

            expect(revokedSession1?.revokedBy).toBe(adminUser.id);
            expect(revokedSession2?.revokedBy).toBe(adminUser.id);
            expect(revokedSession1!.revokedAt!.getTime()).toBeGreaterThanOrEqual(beforeRevoke.getTime());
            expect(revokedSession2!.revokedAt!.getTime()).toBeGreaterThanOrEqual(beforeRevoke.getTime());
        });

        it('should not revoke already revoked sessions', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const session1 = await repository.create({ tokenHash: 'hash-1', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'hash-2', expiresAt, userId: testUser.id });

            // Manually revoke one session first
            await repository.revokeById(session1.id, testUser.id);

            const count = await repository.revokeAllByUserId(testUser.id, testUser.id);

            // Should only revoke the one active session
            expect(count).toBe(1);
        });

        it('should not affect other users sessions', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            // Create another user
            const otherUser = await usersRepository.create({
                displayName: 'Other User',
                oidcSub: 'oidc-sub-other',
                wallets: [],
                source: 'adminPanel'
            });

            await repository.create({ tokenHash: 'user1-hash-1', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'user1-hash-2', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'user2-hash', expiresAt, userId: otherUser.id });

            await repository.revokeAllByUserId(testUser.id, testUser.id);

            const otherUserSessions = await repository.findActiveByUserId(otherUser.id);
            expect(otherUserSessions).toHaveLength(1);
            expect(otherUserSessions[0]?.tokenHash).toBe('user2-hash');
        });
    });

    describe('revokeAllByUserIdExcept', () => {
        it('should revoke all sessions except the specified token hash', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({ tokenHash: 'keep-hash', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'revoke-1', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'revoke-2', expiresAt, userId: testUser.id });

            const count = await repository.revokeAllByUserIdExcept(testUser.id, 'keep-hash', testUser.id);

            expect(count).toBe(2);

            const activeSessions = await repository.findActiveByUserId(testUser.id);
            expect(activeSessions).toHaveLength(1);
            expect(activeSessions[0]?.tokenHash).toBe('keep-hash');
        });

        it('should return 0 when only one session exists', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await repository.create({ tokenHash: 'only-hash', expiresAt, userId: testUser.id });

            const count = await repository.revokeAllByUserIdExcept(testUser.id, 'only-hash', testUser.id);

            expect(count).toBe(0);

            const activeSessions = await repository.findActiveByUserId(testUser.id);
            expect(activeSessions).toHaveLength(1);
        });

        it('should not revoke already revoked sessions', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await repository.create({ tokenHash: 'keep-hash', expiresAt, userId: testUser.id });
            const session2 = await repository.create({
                tokenHash: 'already-revoked',
                expiresAt,
                userId: testUser.id
            });
            await repository.create({ tokenHash: 'active-revoke', expiresAt, userId: testUser.id });

            // Manually revoke one session first
            await repository.revokeById(session2.id, testUser.id);

            const count = await repository.revokeAllByUserIdExcept(testUser.id, 'keep-hash', testUser.id);

            // Should only revoke the one active session, not the already-revoked one
            expect(count).toBe(1);
        });

        it('should not affect other users sessions', async () => {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            // Create another user
            const otherUser = await usersRepository.create({
                displayName: 'Other User',
                oidcSub: 'oidc-sub-789',
                wallets: [],
                source: 'adminPanel'
            });

            await repository.create({ tokenHash: 'user1-keep', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'user1-revoke', expiresAt, userId: testUser.id });
            await repository.create({ tokenHash: 'user2-hash', expiresAt, userId: otherUser.id });

            await repository.revokeAllByUserIdExcept(testUser.id, 'user1-keep', testUser.id);

            const otherUserSessions = await repository.findActiveByUserId(otherUser.id);
            expect(otherUserSessions).toHaveLength(1);
            expect(otherUserSessions[0]?.tokenHash).toBe('user2-hash');
        });
    });

    describe('renewableUntil column', () => {
        it('should persist renewableUntil when provided on create', async () => {
            const expiresAt = addDays(new Date(), 1);
            const renewableUntil = addDays(new Date(), 3);

            const session = await repository.create({
                tokenHash: 'absolute-expires-hash',
                expiresAt,
                renewableUntil,
                userId: testUser.id
            });

            expect(session.renewableUntil).toEqual(renewableUntil);
        });

        it('should allow renewableUntil to be null (nullable column)', async () => {
            const expiresAt = addDays(new Date(), 1);

            const session = await repository.create({
                tokenHash: 'null-absolute-expires-hash',
                expiresAt,
                userId: testUser.id
            });

            expect(session.renewableUntil).toBeNull();
        });

        it('backfill: UPDATE ... WHERE renewable_until IS NULL sets null rows to expires_at and leaves non-null rows unchanged', async ({
            db
        }) => {
            // Simulate a pre-migration row: insert directly bypassing the repository so
            // renewable_until stays NULL (mimicking a row that existed before the migration).
            const expiresAt = addDays(new Date(), 1);
            const preExistingRows = await db
                .insert(sessionsTable)
                .values({
                    tokenHash: 'pre-migration-row',
                    expiresAt,
                    userId: testUser.id,
                    renewableUntil: null
                })
                .returning();
            const preExistingRow = preExistingRows[0]!;

            // Also insert a row that already has a non-null renewableUntil (should be left alone).
            const existingRenewableUntil = addDays(new Date(), 3);
            const alreadyBackfilledRows = await db
                .insert(sessionsTable)
                .values({
                    tokenHash: 'already-backfilled-row',
                    expiresAt,
                    userId: testUser.id,
                    renewableUntil: existingRenewableUntil
                })
                .returning();
            const alreadyBackfilledRow = alreadyBackfilledRows[0]!;

            // Run the migration's backfill statement verbatim.
            await db.execute(sql`UPDATE sessions SET renewable_until = expires_at WHERE renewable_until IS NULL`);

            // (a) The pre-migration row must now have renewableUntil === expiresAt.
            const updatedPreExisting = await db.query.sessionsTable.findFirst({
                where: (sessions, { eq }) => eq(sessions.id, preExistingRow.id)
            });
            expect(updatedPreExisting?.renewableUntil).toBeDefined();
            expect(updatedPreExisting!.renewableUntil!.getTime()).toBe(expiresAt.getTime());

            // (b) The already-backfilled row must be unchanged (WHERE IS NULL guard).
            const updatedAlreadyBackfilled = await db.query.sessionsTable.findFirst({
                where: (sessions, { eq }) => eq(sessions.id, alreadyBackfilledRow.id)
            });
            expect(updatedAlreadyBackfilled!.renewableUntil!.getTime()).toBe(existingRenewableUntil.getTime());
        });
    });

    describe('extendByTokenHash', () => {
        it('returns the updated row with the new expiresAt for an active session', async () => {
            const originalExpiresAt = addHours(new Date(), 1);
            const session = await repository.create({
                tokenHash: 'extend-active-hash',
                expiresAt: originalExpiresAt,
                userId: testUser.id
            });

            const newExpiresAt = addMinutes(new Date(), 30);
            const updated = await repository.extendByTokenHash('extend-active-hash', newExpiresAt);

            expect(updated).toBeDefined();
            expect(updated?.tokenHash).toBe('extend-active-hash');
            expect(updated?.expiresAt.getTime()).toBe(newExpiresAt.getTime());
            expect(updated?.id).toBe(session.id);
        });

        it('returns undefined for an expired session (TOCTOU active predicate)', async ({ db }) => {
            const pastDate = subSeconds(new Date(), 10);
            await db.insert(sessionsTable).values({
                tokenHash: 'extend-expired-hash',
                expiresAt: pastDate,
                userId: testUser.id
            });

            const newExpiresAt = addMinutes(new Date(), 30);
            const updated = await repository.extendByTokenHash('extend-expired-hash', newExpiresAt);

            expect(updated).toBeUndefined();
        });

        it('returns undefined for a revoked session (TOCTOU active predicate)', async () => {
            const expiresAt = addHours(new Date(), 1);
            const session = await repository.create({
                tokenHash: 'extend-revoked-hash',
                expiresAt,
                userId: testUser.id
            });

            await repository.revokeById(session.id, testUser.id);

            const newExpiresAt = addMinutes(new Date(), 30);
            const updated = await repository.extendByTokenHash('extend-revoked-hash', newExpiresAt);

            expect(updated).toBeUndefined();
        });
    });

    describe('deleteExpiredOrRevoked', () => {
        it('should delete expired and revoked sessions while keeping active sessions', async () => {
            const futureExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const expiredSession = await repository.create({
                tokenHash: 'expired-to-prune',
                expiresAt: new Date(Date.now() - 1000),
                userId: testUser.id
            });
            const revokedSession = await repository.create({
                tokenHash: 'revoked-to-prune',
                expiresAt: futureExpiresAt,
                userId: testUser.id
            });
            const activeSession = await repository.create({
                tokenHash: 'active-to-keep',
                expiresAt: futureExpiresAt,
                userId: testUser.id
            });

            await repository.revokeById(revokedSession.id, testUser.id);

            const deletedCount = await repository.deleteExpiredOrRevoked();

            expect(deletedCount).toBe(2);
            expect(await repository.findById(expiredSession.id)).toBeUndefined();
            expect(await repository.findById(revokedSession.id)).toBeUndefined();
            expect(await repository.findById(activeSession.id)).toBeDefined();
        });

        it('should return zero when there are no expired or revoked sessions', async () => {
            await repository.create({
                tokenHash: 'only-active-session',
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                userId: testUser.id
            });

            const deletedCount = await repository.deleteExpiredOrRevoked();

            expect(deletedCount).toBe(0);
        });
    });
});
