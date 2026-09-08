import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import type { PasskeyTransport } from '../db/schema';
import { PasskeyChallengesRepository } from '../repositories/passkey-challenges-repository';
import { type PasskeyCredential, PasskeyCredentialsRepository } from '../repositories/passkey-credentials-repository';
import { RolesRepository } from '../repositories/roles-repository';
import { type User, UsersRepository } from '../repositories/users-repository';
import { AdminMfaService } from './admin-mfa-service';
import { type AuditLogContext, AuditLogsService, fakeAuditLogContextForTests } from './audit-logs-service';
import { PasskeyService } from './passkey-service';
import { WebAuthnService } from './webauthn-service';

describe('AdminMfaService', () => {
    let service: AdminMfaService;
    let passkeyService: PasskeyService;
    let webauthnService: WebAuthnService;
    let credentialsRepo: PasskeyCredentialsRepository;
    let challengesRepo: PasskeyChallengesRepository;
    let usersRepository: UsersRepository;
    let rolesRepository: RolesRepository;
    let testUser: User;
    let fakeCtx: AuditLogContext;

    const webauthnConfig = {
        rpName: 'Test RP',
        rpId: 'localhost',
        origins: ['http://localhost:3000'],
        requireUserVerification: false
    };

    beforeEach<Fixture>(async ({ db }) => {
        const auditLogsService = new AuditLogsService(new Repositories(db));
        fakeCtx = fakeAuditLogContextForTests(auditLogsService);

        credentialsRepo = new PasskeyCredentialsRepository(db);
        challengesRepo = new PasskeyChallengesRepository(db);
        usersRepository = new UsersRepository(db);
        rolesRepository = new RolesRepository(db);

        // Ensure admin role exists before creating users with it
        const adminRole = await rolesRepository.createOrUpdateAdminRole();

        // Create test user with admin role
        testUser = await usersRepository.create({
            displayName: 'Test Admin',
            source: 'oidc',
            oidcSub: 'oidc-sub-123',
            roles: [adminRole.id]
        });

        // Real WebAuthnService - we'll spy on verify methods for crypto operations
        webauthnService = new WebAuthnService(webauthnConfig);

        // Real PasskeyService
        passkeyService = new PasskeyService({
            webauthnService,
            repos: new Repositories(db)
        });

        service = new AdminMfaService({
            passkeyService,
            repos: new Repositories(db)
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('handleMfa', () => {
        describe('when admin has existing passkeys', () => {
            let existingCredential: PasskeyCredential;

            beforeEach(async () => {
                existingCredential = await credentialsRepo.create({
                    userId: testUser.id,
                    credentialId: 'credential-id-base64',
                    publicKey: 'public-key-base64url',
                    counter: 5,
                    deviceName: 'Test Device',
                    transports: ['internal'] as PasskeyTransport[]
                });
            });

            it('returns mfa_challenge when no assertion provided', async () => {
                const result = await service.handleMfa({
                    user: testUser,
                    passkeyAssertion: undefined,
                    ctx: fakeCtx
                });

                expect(result.type).toBe('mfa_challenge');
                if (result.type === 'mfa_challenge') {
                    expect(result.rpId).toBe('localhost');
                    expect(result.challenge).toBeDefined();
                    expect(typeof result.challenge).toBe('string');
                    expect(result.allowCredentials).toEqual([
                        {
                            id: 'credential-id-base64',
                            transports: ['internal']
                        }
                    ]);

                    // Verify challenge was stored in database
                    const storedChallenge = await challengesRepo.findByChallenge(result.challenge);
                    expect(storedChallenge).toBeDefined();
                    expect(storedChallenge?.userId).toBe(testUser.id);
                    expect(storedChallenge?.challengeType).toBe('authentication');
                }
            });

            it('returns success when valid assertion provided', async () => {
                // First, get a challenge
                const challengeResult = await service.handleMfa({
                    user: testUser,
                    passkeyAssertion: undefined,
                    ctx: fakeCtx
                });
                expect(challengeResult.type).toBe('mfa_challenge');
                const challenge = challengeResult.type === 'mfa_challenge' ? challengeResult.challenge : '';

                // Spy on verifyAuthentication to return successful verification
                vi.spyOn(webauthnService, 'verifyAuthentication').mockResolvedValue({
                    verified: true,
                    authenticationInfo: { newCounter: 6 }
                } as never);

                const mockAssertion = {
                    id: 'credential-id-base64',
                    rawId: 'raw-id',
                    response: {
                        clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url'),
                        authenticatorData: 'auth-data',
                        signature: 'signature',
                        clientData: { challenge }
                    },
                    clientExtensionResults: {},
                    type: 'public-key' as const
                };

                const result = await service.handleMfa({
                    user: testUser,
                    passkeyAssertion: mockAssertion,
                    ctx: fakeCtx
                });

                expect(result).toEqual({ type: 'success' });

                // Verify counter was updated in database
                const updatedCredential = await credentialsRepo.findById(existingCredential.id);
                expect(updatedCredential?.counter).toBe(6);
            });

            it('throws InvalidInputError when credential not found', async () => {
                // First, get a challenge
                const challengeResult = await service.handleMfa({
                    user: testUser,
                    passkeyAssertion: undefined,
                    ctx: fakeCtx
                });
                expect(challengeResult.type).toBe('mfa_challenge');
                const challenge = challengeResult.type === 'mfa_challenge' ? challengeResult.challenge : '';

                const mockAssertion = {
                    id: 'unknown-credential-id',
                    rawId: 'raw-id',
                    response: {
                        clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url'),
                        authenticatorData: 'auth-data',
                        signature: 'signature',
                        clientData: { challenge }
                    },
                    clientExtensionResults: {},
                    type: 'public-key' as const
                };

                await expect(
                    service.handleMfa({
                        user: testUser,
                        passkeyAssertion: mockAssertion,
                        ctx: fakeCtx
                    })
                ).rejects.toThrow('Unknown credential');
            });

            it('throws InvalidInputError when verification fails', async () => {
                // First, get a challenge
                const challengeResult = await service.handleMfa({
                    user: testUser,
                    passkeyAssertion: undefined,
                    ctx: fakeCtx
                });
                expect(challengeResult.type).toBe('mfa_challenge');
                const challenge = challengeResult.type === 'mfa_challenge' ? challengeResult.challenge : '';

                // Spy on verifyAuthentication to return failed verification
                vi.spyOn(webauthnService, 'verifyAuthentication').mockResolvedValue({
                    verified: false
                } as never);

                const mockAssertion = {
                    id: 'credential-id-base64',
                    rawId: 'raw-id',
                    response: {
                        clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url'),
                        authenticatorData: 'auth-data',
                        signature: 'signature',
                        clientData: { challenge }
                    },
                    clientExtensionResults: {},
                    type: 'public-key' as const
                };

                await expect(
                    service.handleMfa({
                        user: testUser,
                        passkeyAssertion: mockAssertion,
                        ctx: fakeCtx
                    })
                ).rejects.toThrow('Authentication verification failed');
            });
        });

        describe('when admin has no passkeys (first login)', () => {
            it('returns success immediately (registration is optional)', async () => {
                const result = await service.handleMfa({
                    user: testUser,
                    passkeyAssertion: undefined,
                    ctx: fakeCtx
                });

                // Admin without passkeys should get success immediately
                // Registration is now optional and handled on the frontend
                expect(result).toEqual({ type: 'success' });
            });

            it('returns success with linkedSiweNonce when provided', async () => {
                const result = await service.handleMfa({
                    user: testUser,
                    passkeyAssertion: undefined,
                    ctx: fakeCtx,
                    linkedSiweNonce: 'test-siwe-nonce'
                });

                expect(result).toEqual({ type: 'success', linkedSiweNonce: 'test-siwe-nonce' });
            });
        });
    });
});
