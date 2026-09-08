import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import type { PasskeyTransport } from '../db/schema';
import { PasskeyChallengesRepository } from '../repositories/passkey-challenges-repository';
import { type PasskeyCredential, PasskeyCredentialsRepository } from '../repositories/passkey-credentials-repository';
import { type User, UsersRepository } from '../repositories/users-repository';
import { ForbiddenError } from '../utils/error-types';
import { PasskeyService } from './passkey-service';
import { WebAuthnService } from './webauthn-service';

describe('PasskeyService', () => {
    let service: PasskeyService;
    let webauthnService: WebAuthnService;
    let credentialsRepo: PasskeyCredentialsRepository;
    let challengesRepo: PasskeyChallengesRepository;
    let usersRepository: UsersRepository;
    let testUser: User;

    const webauthnConfig = {
        rpName: 'Test RP',
        rpId: 'localhost',
        origins: ['http://localhost:3000'],
        requireUserVerification: false
    };

    beforeEach<Fixture>(async ({ db }) => {
        credentialsRepo = new PasskeyCredentialsRepository(db);
        challengesRepo = new PasskeyChallengesRepository(db);
        usersRepository = new UsersRepository(db);

        // Create test user
        testUser = await usersRepository.create({ displayName: 'Test User', source: 'adminPanel' });

        // Real WebAuthnService - we'll spy on verify methods that need crypto
        webauthnService = new WebAuthnService(webauthnConfig);

        service = new PasskeyService({
            webauthnService,
            repos: new Repositories(db)
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('beginRegistration', () => {
        it('creates challenge and returns registration options', async () => {
            const result = await service.beginRegistration({
                userId: testUser.id,
                userName: 'Test User',
                existingCredentials: []
            });

            // Verify result structure
            expect(result.challenge).toBeDefined();
            expect(typeof result.challenge).toBe('string');
            expect(result.rp).toEqual({ name: 'Test RP', id: 'localhost' });
            expect(result.user.name).toBe('Test User');
            expect(result.authenticatorSelection).toMatchObject({
                residentKey: 'required',
                userVerification: 'preferred'
            });
            expect(result.authenticatorSelection?.authenticatorAttachment).toBeUndefined();

            // Verify challenge is stored in database
            const storedChallenge = await challengesRepo.findByChallenge(result.challenge);
            expect(storedChallenge).toBeDefined();
            expect(storedChallenge?.userId).toBe(testUser.id);
            expect(storedChallenge?.challengeType).toBe('registration');
            expect(storedChallenge?.alreadyUsed).toBe(false);
        });

        it('excludes existing credentials', async () => {
            // Create an existing credential
            const existingCredential = await credentialsRepo.create({
                userId: testUser.id,
                credentialId: 'existing-cred-id',
                publicKey: 'test-public-key',
                counter: 0,
                deviceName: 'Existing Device',
                transports: ['internal']
            });

            const result = await service.beginRegistration({
                userId: testUser.id,
                userName: 'Test User',
                existingCredentials: [
                    { credentialId: existingCredential.credentialId, transports: existingCredential.transports }
                ]
            });

            expect(result.excludeCredentials).toContainEqual(
                expect.objectContaining({ id: existingCredential.credentialId })
            );
        });
    });

    describe('finishRegistration', () => {
        it('throws InvalidInputError when verification fails', async () => {
            // Create a registration challenge first
            const beginResult = await service.beginRegistration({
                userId: testUser.id,
                userName: 'Test User',
                existingCredentials: []
            });

            // Spy on verifyRegistration to return unverified
            vi.spyOn(webauthnService, 'verifyRegistration').mockResolvedValue({
                verified: false
            } as never);

            const mockRegistration = {
                id: 'new-credential-id',
                rawId: 'raw-id',
                response: {
                    clientDataJSON: 'data',
                    attestationObject: 'attestation-object',
                    clientData: { challenge: beginResult.challenge }
                },
                clientExtensionResults: {},
                type: 'public-key' as const
            };

            await expect(
                service.finishRegistration({
                    userId: testUser.id,
                    response: mockRegistration,
                    deviceName: null
                })
            ).rejects.toThrow('Registration verification failed');
        });

        it('verifies registration and stores credential', async () => {
            // Create a registration challenge first
            const beginResult = await service.beginRegistration({
                userId: testUser.id,
                userName: 'Test User',
                existingCredentials: []
            });

            // Spy on verifyRegistration to return successful verification
            vi.spyOn(webauthnService, 'verifyRegistration').mockResolvedValue({
                verified: true,
                registrationInfo: {
                    credential: {
                        id: 'new-credential-id',
                        publicKey: new Uint8Array([1, 2, 3, 4]),
                        counter: 0
                    }
                }
            } as never);

            const mockRegistration = {
                id: 'new-credential-id',
                rawId: 'raw-id',
                response: {
                    clientDataJSON: Buffer.from(JSON.stringify({ challenge: beginResult.challenge })).toString(
                        'base64url'
                    ),
                    attestationObject: 'attestation-object',
                    transports: ['internal' as const],
                    clientData: { challenge: beginResult.challenge }
                },
                clientExtensionResults: {},
                type: 'public-key' as const
            };

            const result = await service.finishRegistration({
                userId: testUser.id,
                response: mockRegistration,
                deviceName: 'My Device'
            });

            // Verify credential was created
            expect(result.credential.userId).toBe(testUser.id);
            expect(result.credential.credentialId).toBe('new-credential-id');
            expect(result.credential.deviceName).toBe('My Device');
            expect(result.credential.transports).toEqual(['internal']);

            // Verify credential exists in database
            const storedCredential = await credentialsRepo.findByCredentialId('new-credential-id');
            expect(storedCredential).toBeDefined();
            expect(storedCredential?.userId).toBe(testUser.id);

            // Verify challenge was marked as used
            const challenge = await challengesRepo.findByChallenge(beginResult.challenge);
            expect(challenge?.alreadyUsed).toBe(true);
        });

        it('throws when challenge belongs to different user', async () => {
            // Create another user
            const otherUser = await usersRepository.create({ displayName: 'Other User', source: 'adminPanel' });

            // Create a challenge for the other user
            const beginResult = await service.beginRegistration({
                userId: otherUser.id,
                userName: 'Other User',
                existingCredentials: []
            });

            const mockRegistration = {
                id: 'new-credential-id',
                rawId: 'raw-id',
                response: {
                    clientDataJSON: 'data',
                    attestationObject: 'attestation-object',
                    clientData: { challenge: beginResult.challenge }
                },
                clientExtensionResults: {},
                type: 'public-key' as const
            };

            // Try to finish registration with testUser, not otherUser
            await expect(
                service.finishRegistration({
                    userId: testUser.id,
                    response: mockRegistration,
                    deviceName: null
                })
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe('beginAuthentication', () => {
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

        it('creates challenge and returns allowed credentials', async () => {
            const result = await service.beginAuthentication({
                userId: testUser.id,
                existingCredentials: [existingCredential]
            });

            expect(result.rpId).toBe('localhost');
            expect(result.challenge).toBeDefined();
            expect(typeof result.challenge).toBe('string');
            expect(result.allowCredentials).toEqual([
                {
                    id: 'credential-id-base64',
                    transports: ['internal']
                }
            ]);

            // Verify challenge is stored in database
            const storedChallenge = await challengesRepo.findByChallenge(result.challenge);
            expect(storedChallenge).toBeDefined();
            expect(storedChallenge?.userId).toBe(testUser.id);
            expect(storedChallenge?.challengeType).toBe('authentication');
        });

        it('handles credentials without transports', async () => {
            const credentialWithoutTransports = await credentialsRepo.create({
                userId: testUser.id,
                credentialId: 'cred-no-transports',
                publicKey: 'public-key',
                counter: 0,
                deviceName: 'Device',
                transports: null
            });

            const result = await service.beginAuthentication({
                userId: testUser.id,
                existingCredentials: [credentialWithoutTransports]
            });

            expect(result.allowCredentials[0]?.transports).toBeUndefined();
        });
    });

    describe('finishAuthentication', () => {
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

        it('verifies authentication and updates counter', async () => {
            // Create an authentication challenge
            const beginResult = await service.beginAuthentication({
                userId: testUser.id,
                existingCredentials: [existingCredential]
            });

            // Spy on verifyAuthentication to return successful verification
            vi.spyOn(webauthnService, 'verifyAuthentication').mockResolvedValue({
                verified: true,
                authenticationInfo: { newCounter: 6 }
            } as never);

            const mockAssertion = {
                id: 'credential-id-base64',
                rawId: 'raw-id',
                response: {
                    clientDataJSON: 'data',
                    authenticatorData: 'auth-data',
                    signature: 'signature',
                    clientData: { challenge: beginResult.challenge }
                },
                clientExtensionResults: {},
                type: 'public-key' as const
            };

            const result = await service.finishAuthentication({
                userId: testUser.id,
                assertion: mockAssertion,
                credential: existingCredential
            });

            expect(result).toEqual({ verified: true, newCounter: 6 });

            // Verify counter was updated in database
            const updatedCredential = await credentialsRepo.findById(existingCredential.id);
            expect(updatedCredential?.counter).toBe(6);
            expect(updatedCredential?.lastUsedAt).not.toBeNull();

            // Verify challenge was marked as used
            const challenge = await challengesRepo.findByChallenge(beginResult.challenge);
            expect(challenge?.alreadyUsed).toBe(true);
        });

        it('throws InvalidInputError when verification fails', async () => {
            const beginResult = await service.beginAuthentication({
                userId: testUser.id,
                existingCredentials: [existingCredential]
            });

            vi.spyOn(webauthnService, 'verifyAuthentication').mockResolvedValue({
                verified: false
            } as never);

            const mockAssertion = {
                id: 'credential-id-base64',
                rawId: 'raw-id',
                response: {
                    clientDataJSON: 'data',
                    authenticatorData: 'auth-data',
                    signature: 'signature',
                    clientData: { challenge: beginResult.challenge }
                },
                clientExtensionResults: {},
                type: 'public-key' as const
            };

            await expect(
                service.finishAuthentication({
                    userId: testUser.id,
                    assertion: mockAssertion,
                    credential: existingCredential
                })
            ).rejects.toThrow('Authentication verification failed');
        });

        it('throws when challenge validation fails', async () => {
            const mockAssertion = {
                id: 'credential-id-base64',
                rawId: 'raw-id',
                response: {
                    clientDataJSON: 'data',
                    authenticatorData: 'auth-data',
                    signature: 'signature',
                    clientData: { challenge: 'non-existent-challenge' }
                },
                clientExtensionResults: {},
                type: 'public-key' as const
            };

            await expect(
                service.finishAuthentication({
                    userId: testUser.id,
                    assertion: mockAssertion,
                    credential: existingCredential
                })
            ).rejects.toThrow('Invalid or expired challenge');
        });

        it('throws ForbiddenError when challenge belongs to different user', async () => {
            // Create another user
            const otherUser = await usersRepository.create({ displayName: 'Other User', source: 'adminPanel' });

            // Create a challenge for the other user
            const beginResult = await service.beginAuthentication({
                userId: otherUser.id,
                existingCredentials: [existingCredential]
            });

            const mockAssertion = {
                id: 'credential-id-base64',
                rawId: 'raw-id',
                response: {
                    clientDataJSON: 'data',
                    authenticatorData: 'auth-data',
                    signature: 'signature',
                    clientData: { challenge: beginResult.challenge }
                },
                clientExtensionResults: {},
                type: 'public-key' as const
            };

            // Try to finish authentication with testUser, not otherUser
            await expect(
                service.finishAuthentication({
                    userId: testUser.id,
                    assertion: mockAssertion,
                    credential: existingCredential
                })
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe('findExistingKey', () => {
        it('returns credential when found', async () => {
            const credential = await credentialsRepo.create({
                userId: testUser.id,
                credentialId: 'credential-id-base64',
                publicKey: 'public-key',
                counter: 0,
                deviceName: 'Device',
                transports: null
            });

            const result = service.findExistingKey([credential], 'credential-id-base64');

            expect(result).toEqual(credential);
        });

        it('throws InvalidInputError when credential not found', () => {
            expect(() => service.findExistingKey([], 'unknown-id')).toThrow('Unknown credential');
        });
    });
});
