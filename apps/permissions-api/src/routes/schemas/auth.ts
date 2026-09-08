import { z } from 'zod/v4';
import { WebAuthnPublicKeyCredentialSchema } from '../../utils/schemas/webauthn';

export const AuthResponseSchema = z.object({
    token: z.string(),
    expiresAt: z.iso.datetime(),
    renewableUntil: z.iso.datetime()
});

export const MfaChallengeResponseSchema = z.object({
    requiresMfa: z.literal(true),
    rpId: z.string(),
    challenge: z.string(),
    allowCredentials: z.array(WebAuthnPublicKeyCredentialSchema)
});

export const AuthResponseWithMfaSchema = z.union([AuthResponseSchema, MfaChallengeResponseSchema]);
