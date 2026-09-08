import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import type { Repositories } from '../db';
import type { PasskeyTransport } from '../db/schema';
import type { PasskeyCredential } from '../repositories/passkey-credentials-repository';
import { InvalidInputError } from '../utils/error-types';
import type { WebAuthnAuthenticationResponse, WebAuthnRegistrationResponse } from '../utils/schemas/webauthn';
import type { ExistingCredential, WebAuthnService } from './webauthn-service';

export type RegistrationBeginResult = PublicKeyCredentialCreationOptionsJSON & {
    challenge: string;
    linkedSiweNonce?: string;
};

export interface AuthenticationBeginResult {
    rpId: string;
    challenge: string;
    allowCredentials: { id: string; transports?: PasskeyTransport[] }[];
    linkedSiweNonce?: string;
}

export interface AuthenticationFinishResult {
    verified: boolean;
    newCounter: number;
    linkedSiweNonce?: string;
}

export interface RegistrationFinishResult {
    credential: PasskeyCredential;
    linkedSiweNonce?: string;
}

interface PasskeyServiceDeps {
    webauthnService: WebAuthnService;
    repos: Repositories;
}

export class PasskeyService {
    private readonly webauthnService: WebAuthnService;
    private readonly repos: Repositories;

    constructor({ webauthnService, repos }: PasskeyServiceDeps) {
        this.webauthnService = webauthnService;
        this.repos = repos;
    }

    /**
     * Begin passkey registration flow.
     * Creates a challenge and generates registration options.
     */
    async beginRegistration({
        userId,
        userName,
        existingCredentials,
        linkedSiweNonce
    }: {
        userId: string;
        userName: string;
        existingCredentials: ExistingCredential[];
        linkedSiweNonce?: string;
    }): Promise<RegistrationBeginResult> {
        const challenge = await this.repos.passkeyChallenges.create(userId, 'registration', { linkedSiweNonce });
        const options = await this.webauthnService.generateRegistrationOptions(userId, userName, existingCredentials);

        return {
            ...options,
            challenge: challenge.challenge,
            linkedSiweNonce: challenge.linkedSiweNonce ?? undefined
        };
    }

    /**
     * Finish passkey registration flow.
     * Validates challenge, verifies registration, and stores credential.
     */
    async finishRegistration({
        userId,
        response,
        deviceName
    }: {
        userId: string;
        response: WebAuthnRegistrationResponse;
        deviceName: string | null;
    }): Promise<RegistrationFinishResult> {
        const challengeRecord = await this.repos.passkeyChallenges.findByChallenge(
            response.response.clientData.challenge
        );
        this.webauthnService.validateChallenge(challengeRecord, userId, 'registration');

        const verification = await this.webauthnService.verifyRegistration(challengeRecord.challenge, response);
        if (!verification.verified || !verification.registrationInfo) {
            throw new InvalidInputError('Registration verification failed');
        }

        const credential = await this.repos.transaction(async (tx) => {
            await tx.repositories().passkeyChallenges.markAsUsed(challengeRecord.challenge);
            // Invalidate any other pending registration challenges for this user.
            await tx.repositories().passkeyChallenges.markAllPendingAsUsed(userId, 'registration');
            return tx.repositories().passkeyCredentials.create({
                userId,
                credentialId: verification.registrationInfo.credential.id,
                publicKey: Buffer.from(verification.registrationInfo.credential.publicKey).toString('base64url'),
                counter: verification.registrationInfo.credential.counter,
                deviceName,
                transports: response.response.transports ?? null,
                lastUsedAt: new Date()
            });
        });

        return {
            credential,
            linkedSiweNonce: challengeRecord.linkedSiweNonce ?? undefined
        };
    }

    /**
     * Begin passkey authentication flow.
     * Creates a challenge and returns allowed credentials.
     */
    async beginAuthentication({
        userId,
        existingCredentials,
        linkedSiweNonce,
        linkedAction,
        challengeType = 'authentication'
    }: {
        userId: string;
        existingCredentials: PasskeyCredential[];
        linkedSiweNonce?: string;
        linkedAction?: string;
        challengeType?: 'authentication' | 'step_up';
    }): Promise<AuthenticationBeginResult> {
        const challenge = await this.repos.passkeyChallenges.create(userId, challengeType, {
            linkedSiweNonce,
            linkedAction
        });
        return {
            rpId: this.webauthnService.getRpId(),
            challenge: challenge.challenge,
            allowCredentials: existingCredentials.map((c) => ({
                id: c.credentialId,
                transports: c.transports ?? undefined
            })),
            linkedSiweNonce: challenge.linkedSiweNonce ?? undefined
        };
    }

    /**
     * Finish passkey authentication flow.
     * Validates challenge, verifies authentication, and updates credential counter.
     */
    async finishAuthentication({
        userId,
        assertion,
        credential,
        challengeType = 'authentication'
    }: {
        userId: string;
        assertion: WebAuthnAuthenticationResponse;
        credential: PasskeyCredential;
        challengeType?: 'authentication' | 'step_up';
    }): Promise<AuthenticationFinishResult> {
        const challengeRecord = await this.repos.passkeyChallenges.findByChallenge(
            assertion.response.clientData.challenge
        );
        this.webauthnService.validateChallenge(challengeRecord, userId, challengeType);

        const verification = await this.webauthnService.verifyAuthentication(challengeRecord.challenge, assertion, {
            credentialId: credential.credentialId,
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports: credential.transports
        });

        if (!verification.verified) {
            throw new InvalidInputError('Authentication verification failed');
        }

        const newCounter = verification.authenticationInfo.newCounter;

        await this.repos.transaction(async (tx) => {
            await tx.repositories().passkeyChallenges.markAsUsed(challengeRecord.challenge);
            await tx
                .repositories()
                .passkeyCredentials.updateById(credential.id, { counter: newCounter, lastUsedAt: new Date() });
        });

        return {
            verified: true,
            newCounter,
            linkedSiweNonce: challengeRecord.linkedSiweNonce ?? undefined
        };
    }

    /**
     * Find credential by ID from a list of credentials.
     * Throws if not found.
     */
    findExistingKey(credentials: PasskeyCredential[], credentialId: string): PasskeyCredential {
        const credential = credentials.find((c) => c.credentialId === credentialId);
        if (!credential) {
            throw new InvalidInputError('Unknown credential');
        }
        return credential;
    }
}
