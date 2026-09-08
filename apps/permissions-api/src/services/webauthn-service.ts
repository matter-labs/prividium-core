import { Buffer } from 'node:buffer';
import {
    type AuthenticationResponseJSON,
    type AuthenticatorTransportFuture,
    generateAuthenticationOptions,
    generateRegistrationOptions,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    type RegistrationResponseJSON,
    type VerifiedAuthenticationResponse,
    type VerifiedRegistrationResponse,
    verifyAuthenticationResponse,
    verifyRegistrationResponse
} from '@simplewebauthn/server';
import type { PasskeyChallenge } from '../repositories/passkey-challenges-repository';
import { ForbiddenError, InvalidInputError } from '../utils/error-types';

export interface WebAuthnConfig {
    rpName: string;
    rpId: string;
    origins: string[];
    requireUserVerification: boolean;
    authenticatorAttachment?: 'platform' | 'cross-platform';
}

export interface ExistingCredential {
    credentialId: string;
    transports?: string[] | null;
}

export interface CredentialForAuth {
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: string[] | null;
}

export class WebAuthnService {
    private readonly config: WebAuthnConfig;

    constructor(config: WebAuthnConfig) {
        this.config = config;
    }

    getRpId(): string {
        return this.config.rpId;
    }

    async generateRegistrationOptions(
        userId: string,
        userName: string,
        existingCredentials: ExistingCredential[]
    ): Promise<PublicKeyCredentialCreationOptionsJSON> {
        return generateRegistrationOptions({
            rpName: this.config.rpName,
            rpID: this.config.rpId,
            userID: Buffer.from(userId, 'utf8'),
            userName,
            // Don't request additional information from the passkey device
            attestationType: 'none',
            // Prevent user from re-registering same credential
            excludeCredentials: existingCredentials.map((cred) => ({
                id: cred.credentialId,
                transports: (cred.transports ?? []) as AuthenticatorTransportFuture[]
            })),
            authenticatorSelection: {
                // Creates a discoverable credential
                residentKey: 'required',
                // Allows using passkeys in a device without biometrics
                userVerification: this.config.requireUserVerification ? 'required' : 'preferred',
                // When unset, the browser presents all authenticator types (platform + cross-platform).
                // Set to 'platform' to restrict to device-native authenticators (Touch ID, Windows Hello).
                // Set to 'cross-platform' to restrict to roaming authenticators (1Password, YubiKey, etc.).
                ...(this.config.authenticatorAttachment !== undefined
                    ? { authenticatorAttachment: this.config.authenticatorAttachment }
                    : {})
            }
        });
    }

    async verifyRegistration(
        expectedChallenge: string,
        response: RegistrationResponseJSON
    ): Promise<VerifiedRegistrationResponse> {
        return verifyRegistrationResponse({
            response,
            expectedChallenge,
            expectedOrigin: this.config.origins,
            expectedRPID: this.config.rpId,
            requireUserVerification: this.config.requireUserVerification
        });
    }

    async generateAuthenticationOptions(
        allowCredentials: ExistingCredential[]
    ): Promise<PublicKeyCredentialRequestOptionsJSON> {
        return generateAuthenticationOptions({
            rpID: this.config.rpId,
            allowCredentials: allowCredentials.map((cred) => ({
                id: cred.credentialId,
                transports: (cred.transports ?? []) as AuthenticatorTransportFuture[]
            })),
            userVerification: this.config.requireUserVerification ? 'required' : 'preferred'
        });
    }

    async verifyAuthentication(
        expectedChallenge: string,
        response: AuthenticationResponseJSON,
        credential: CredentialForAuth
    ): Promise<VerifiedAuthenticationResponse> {
        return verifyAuthenticationResponse({
            response,
            expectedChallenge,
            expectedOrigin: this.config.origins,
            expectedRPID: this.config.rpId,
            credential: {
                id: credential.credentialId,
                publicKey: Buffer.from(credential.publicKey, 'base64url'),
                counter: credential.counter,
                transports: (credential.transports ?? []) as AuthenticatorTransportFuture[]
            },
            requireUserVerification: this.config.requireUserVerification
        });
    }

    validateChallenge(
        challengeRecord: PasskeyChallenge | undefined | null,
        userId: string,
        expectedType: 'authentication' | 'registration' | 'step_up'
    ): asserts challengeRecord is NonNullable<PasskeyChallenge> {
        if (!challengeRecord) {
            throw new InvalidInputError('Invalid or expired challenge');
        }
        if (challengeRecord.userId !== userId) {
            throw new ForbiddenError();
        }
        if (challengeRecord.alreadyUsed) {
            throw new InvalidInputError('Challenge already used');
        }
        if (challengeRecord.expiresAt < new Date()) {
            throw new InvalidInputError('Challenge expired');
        }
        if (challengeRecord.challengeType !== expectedType) {
            throw new InvalidInputError('Invalid challenge type');
        }
    }
}
