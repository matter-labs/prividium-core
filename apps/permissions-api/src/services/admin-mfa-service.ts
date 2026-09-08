import type { Repositories } from '../db';
import type { PasskeyCredential } from '../repositories/passkey-credentials-repository';
import type { User } from '../repositories/users-repository';
import type { WebAuthnAuthenticationResponse } from '../utils/schemas/webauthn';
import type { AuditLogContext } from './audit-logs-service';
import type { AuthenticationBeginResult, PasskeyService } from './passkey-service';

export type MfaResult =
    | { type: 'success'; linkedSiweNonce?: string }
    | ({ type: 'mfa_challenge' } & AuthenticationBeginResult);

interface AdminMfaServiceDeps {
    passkeyService: PasskeyService;
    repos: Repositories;
}

export class AdminMfaService {
    private readonly passkeyService: PasskeyService;
    private readonly repos: Repositories;

    constructor({ passkeyService, repos }: AdminMfaServiceDeps) {
        this.passkeyService = passkeyService;
        this.repos = repos;
    }

    async handleMfa({
        user,
        passkeyAssertion,
        ctx,
        linkedSiweNonce
    }: {
        user: User;
        passkeyAssertion: WebAuthnAuthenticationResponse | undefined;
        ctx: AuditLogContext;
        linkedSiweNonce?: string;
    }): Promise<MfaResult> {
        const existingCredentials = await this.repos.passkeyCredentials.findByUserId(user.id);

        // Admin has passkeys, require MFA assertion
        if (existingCredentials.length > 0) {
            return this.handleAuthentication({
                user,
                existingCredentials,
                ctx,
                linkedSiweNonce,
                passkeyAssertion
            });
        }

        // Admin has no passkeys - return success, registration is optional
        return { type: 'success', linkedSiweNonce };
    }

    private async handleAuthentication({
        user,
        existingCredentials,
        ctx,
        linkedSiweNonce,
        passkeyAssertion
    }: {
        user: User;
        existingCredentials: PasskeyCredential[];
        ctx: AuditLogContext;
        linkedSiweNonce?: string;
        passkeyAssertion?: WebAuthnAuthenticationResponse;
    }): Promise<MfaResult> {
        // PATH 1: Admin didn't provide passkey assertion, generate challenge
        if (!passkeyAssertion) {
            const result = await this.passkeyService.beginAuthentication({
                userId: user.id,
                existingCredentials,
                linkedSiweNonce
            });
            return {
                type: 'mfa_challenge',
                ...result
            };
        }

        // PATH 2: Admin provided a passkey assertion, validate and verify
        try {
            const credential = this.passkeyService.findExistingKey(existingCredentials, passkeyAssertion.id);
            const result = await this.passkeyService.finishAuthentication({
                userId: user.id,
                assertion: passkeyAssertion,
                credential
            });
            return { type: 'success', linkedSiweNonce: result.linkedSiweNonce };
        } catch (error) {
            await ctx.logSecurityEvent('passkey.authenticate-failed', 'passkey', user.id, {
                attemptedCredentialId: passkeyAssertion.id,
                failureReason: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
}
