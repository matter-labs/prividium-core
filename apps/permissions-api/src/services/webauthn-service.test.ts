import { beforeEach, describe, expect, it } from 'vitest';
import type { PasskeyChallenge } from '../repositories/passkey-challenges-repository';
import { ForbiddenError, InvalidInputError } from '../utils/error-types';
import { WebAuthnService } from './webauthn-service';

describe('WebAuthnService', () => {
    const config = {
        rpName: 'Test RP',
        rpId: 'localhost',
        origins: ['http://localhost:3000'],
        requireUserVerification: false
    };

    let service: WebAuthnService;

    beforeEach(() => {
        service = new WebAuthnService(config);
    });

    describe('generateRegistrationOptions', () => {
        it('generates valid options with correct configuration', async () => {
            const result = await service.generateRegistrationOptions('user-123', 'test@example.com', []);

            expect(result.rp).toEqual({ name: 'Test RP', id: 'localhost' });
            expect(result.user.name).toBe('test@example.com');
            expect(result.user.displayName).toBeDefined();
            expect(result.challenge).toBeDefined();
            expect(typeof result.challenge).toBe('string');
            expect(result.challenge.length).toBeGreaterThan(0);
            expect(result.authenticatorSelection).toMatchObject({
                residentKey: 'required',
                userVerification: 'preferred'
            });
            expect(result.authenticatorSelection?.authenticatorAttachment).toBeUndefined();
            expect(result.pubKeyCredParams).toBeDefined();
            expect(result.pubKeyCredParams.length).toBeGreaterThan(0);
        });

        it('restricts to platform authenticators when configured', async () => {
            const platformService = new WebAuthnService({ ...config, authenticatorAttachment: 'platform' });
            const result = await platformService.generateRegistrationOptions('user-123', 'test@example.com', []);

            expect(result.authenticatorSelection?.authenticatorAttachment).toBe('platform');
        });

        it('restricts to cross-platform authenticators when configured', async () => {
            const crossPlatformService = new WebAuthnService({
                ...config,
                authenticatorAttachment: 'cross-platform'
            });
            const result = await crossPlatformService.generateRegistrationOptions('user-123', 'test@example.com', []);

            expect(result.authenticatorSelection?.authenticatorAttachment).toBe('cross-platform');
        });

        it('excludes existing credentials', async () => {
            const existingCredentials = [
                { credentialId: 'cred-1', transports: ['internal'] },
                { credentialId: 'cred-2', transports: null }
            ];

            const result = await service.generateRegistrationOptions(
                'user-123',
                'test@example.com',
                existingCredentials
            );

            expect(result.excludeCredentials).toBeDefined();
            expect(result.excludeCredentials).toHaveLength(2);
            expect(result.excludeCredentials).toContainEqual(expect.objectContaining({ id: 'cred-1' }));
            expect(result.excludeCredentials).toContainEqual(expect.objectContaining({ id: 'cred-2' }));
        });

        it('handles empty existing credentials', async () => {
            const result = await service.generateRegistrationOptions('user-123', 'test@example.com', []);

            expect(result.excludeCredentials).toEqual([]);
        });

        it('generates unique challenges for different calls', async () => {
            const result1 = await service.generateRegistrationOptions('user-1', 'user1@example.com', []);
            const result2 = await service.generateRegistrationOptions('user-2', 'user2@example.com', []);

            expect(result1.challenge).not.toBe(result2.challenge);
        });
    });

    describe('generateAuthenticationOptions', () => {
        it('generates options with allowed credentials', async () => {
            const credentials = [{ credentialId: 'cred-1', transports: ['internal', 'hybrid'] }];

            const result = await service.generateAuthenticationOptions(credentials);

            expect(result.rpId).toBe('localhost');
            expect(result.challenge).toBeDefined();
            expect(typeof result.challenge).toBe('string');
            expect(result.challenge.length).toBeGreaterThan(0);
            expect(result.allowCredentials).toBeDefined();
            expect(result.allowCredentials).toHaveLength(1);
            expect(result.allowCredentials?.[0]).toMatchObject({ id: 'cred-1' });
            expect(result.userVerification).toBe('preferred');
        });

        it('handles credentials without transports', async () => {
            const credentials = [{ credentialId: 'cred-1', transports: null }];

            const result = await service.generateAuthenticationOptions(credentials);

            expect(result.allowCredentials).toBeDefined();
            expect(result.allowCredentials?.[0]?.transports).toEqual([]);
        });

        it('handles multiple credentials', async () => {
            const credentials = [
                { credentialId: 'cred-1', transports: ['internal'] },
                { credentialId: 'cred-2', transports: ['usb'] }
            ];

            const result = await service.generateAuthenticationOptions(credentials);

            expect(result.allowCredentials).toHaveLength(2);
        });
    });

    describe('validateChallenge', () => {
        const createValidChallenge = (overrides?: Partial<PasskeyChallenge>): PasskeyChallenge => ({
            challenge: 'test-challenge',
            userId: 'user-123',
            challengeType: 'authentication',
            alreadyUsed: false,
            expiresAt: new Date(Date.now() + 60000), // 1 minute from now
            linkedSiweNonce: null,
            linkedAction: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides
        });

        it('throws InvalidInputError when challenge is null', () => {
            expect(() => service.validateChallenge(null, 'user-123', 'authentication')).toThrow(InvalidInputError);
            expect(() => service.validateChallenge(null, 'user-123', 'authentication')).toThrow(
                'Invalid or expired challenge'
            );
        });

        it('throws InvalidInputError when challenge is undefined', () => {
            expect(() => service.validateChallenge(undefined, 'user-123', 'authentication')).toThrow(InvalidInputError);
            expect(() => service.validateChallenge(undefined, 'user-123', 'authentication')).toThrow(
                'Invalid or expired challenge'
            );
        });

        it('throws ForbiddenError when userId does not match', () => {
            const challenge = createValidChallenge({ userId: 'different-user' });

            expect(() => service.validateChallenge(challenge, 'user-123', 'authentication')).toThrow(ForbiddenError);
        });

        it('throws InvalidInputError when challenge already used', () => {
            const challenge = createValidChallenge({ alreadyUsed: true });

            expect(() => service.validateChallenge(challenge, 'user-123', 'authentication')).toThrow(InvalidInputError);
            expect(() => service.validateChallenge(challenge, 'user-123', 'authentication')).toThrow(
                'Challenge already used'
            );
        });

        it('throws InvalidInputError when challenge expired', () => {
            const challenge = createValidChallenge({
                expiresAt: new Date(Date.now() - 1000) // 1 second ago
            });

            expect(() => service.validateChallenge(challenge, 'user-123', 'authentication')).toThrow(InvalidInputError);
            expect(() => service.validateChallenge(challenge, 'user-123', 'authentication')).toThrow(
                'Challenge expired'
            );
        });

        it('throws InvalidInputError when challenge type does not match', () => {
            const challenge = createValidChallenge({ challengeType: 'registration' });

            expect(() => service.validateChallenge(challenge, 'user-123', 'authentication')).toThrow(InvalidInputError);
            expect(() => service.validateChallenge(challenge, 'user-123', 'authentication')).toThrow(
                'Invalid challenge type'
            );
        });

        it('passes validation for valid authentication challenge', () => {
            const challenge = createValidChallenge({ challengeType: 'authentication' });

            expect(() => service.validateChallenge(challenge, 'user-123', 'authentication')).not.toThrow();
        });

        it('passes validation for valid registration challenge', () => {
            const challenge = createValidChallenge({
                challengeType: 'registration'
            });

            expect(() => service.validateChallenge(challenge, 'user-123', 'registration')).not.toThrow();
        });
    });

    describe('verifyRegistration', () => {
        it('throws error for invalid attestation data', async () => {
            const invalidResponse = {
                id: 'invalid-id',
                rawId: 'invalid-raw-id',
                response: {
                    clientDataJSON: 'invalid-data',
                    attestationObject: 'invalid-attestation'
                },
                type: 'public-key' as const,
                clientExtensionResults: {}
            };

            await expect(service.verifyRegistration('test-challenge', invalidResponse)).rejects.toThrow();
        });

        it('throws error for malformed response', async () => {
            const malformedResponse = {
                id: '',
                rawId: '',
                response: {
                    clientDataJSON: '',
                    attestationObject: ''
                },
                type: 'public-key' as const,
                clientExtensionResults: {}
            };

            await expect(service.verifyRegistration('test-challenge', malformedResponse)).rejects.toThrow();
        });
    });

    describe('verifyAuthentication', () => {
        it('throws error for invalid authentication data', async () => {
            const invalidResponse = {
                id: 'invalid-id',
                rawId: 'invalid-raw-id',
                response: {
                    clientDataJSON: 'invalid-data',
                    authenticatorData: 'invalid-auth-data',
                    signature: 'invalid-sig'
                },
                type: 'public-key' as const,
                clientExtensionResults: {}
            };

            const credential = {
                credentialId: 'cred-id',
                publicKey: 'dGVzdC1rZXk', // base64url encoded 'test-key'
                counter: 5,
                transports: ['internal']
            };

            await expect(service.verifyAuthentication('auth-challenge', invalidResponse, credential)).rejects.toThrow();
        });

        it('throws error for malformed credential', async () => {
            const response = {
                id: 'cred-id',
                rawId: 'raw-id',
                response: {
                    clientDataJSON: 'data',
                    authenticatorData: 'auth-data',
                    signature: 'sig'
                },
                type: 'public-key' as const,
                clientExtensionResults: {}
            };

            const invalidCredential = {
                credentialId: '',
                publicKey: 'invalid-base64', // not valid base64url
                counter: 0,
                transports: null
            };

            await expect(service.verifyAuthentication('auth-challenge', response, invalidCredential)).rejects.toThrow();
        });
    });
});
