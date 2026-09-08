import { Buffer } from 'node:buffer';
import type {
    AuthenticationResponseJSON,
    PublicKeyCredentialCreationOptionsJSON,
    RegistrationResponseJSON
} from '@simplewebauthn/server';
import { z } from 'zod/v4';
import { PasskeyTransports } from '../../db/schema';

/**
 * WebAuthn PublicKeyCredentialDescriptor, used in `allowCredentials` and `excludeCredentials`.
 *
 * Note: `id` here is the WebAuthn credential ID (base64url string as used by `@simplewebauthn/*` JSON types),
 * not a database row id.
 */
export const WebAuthnPublicKeyCredentialSchema = z.object({
    id: z.string(),
    type: z.literal('public-key'),
    transports: z.array(PasskeyTransports).optional()
});

/**
 * WebAuthn registration (credential creation) options returned to the browser.
 */
export const WebAuthnRegistrationOptionsSchema = z.object({
    challenge: z.string(),
    rp: z.object({
        name: z.string(),
        id: z.string().optional()
    }),
    user: z.object({
        id: z.string(),
        name: z.string(),
        displayName: z.string()
    }),
    pubKeyCredParams: z.array(
        z.object({
            type: z.literal('public-key'),
            alg: z.number()
        })
    ),
    timeout: z.number().optional(),
    excludeCredentials: z.array(WebAuthnPublicKeyCredentialSchema).optional(),
    authenticatorSelection: z
        .object({
            authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
            residentKey: z.enum(['discouraged', 'preferred', 'required']).optional(),
            requireResidentKey: z.boolean().optional(),
            userVerification: z.enum(['discouraged', 'preferred', 'required']).optional()
        })
        .optional(),
    attestation: z.enum(['none', 'indirect', 'direct', 'enterprise']).optional(),
    extensions: z.record(z.string(), z.any()).optional()
}) satisfies z.ZodType<PublicKeyCredentialCreationOptionsJSON>;

/**
 * WebAuthn authentication response coming back from the browser.
 *
 * This schema also parses and attaches `response.clientData.challenge` for convenience.
 */
export const WebAuthnAuthenticationResponseSchema = z.object({
    id: z.string(),
    rawId: z.string(),
    response: z
        .object({
            clientDataJSON: z.base64url(),
            authenticatorData: z.string(),
            signature: z.string(),
            userHandle: z.string().optional()
        })
        .transform((response, ctx) => {
            const clientData = parseClientDataJSONBase64Url(response.clientDataJSON, ctx);
            if (clientData === z.NEVER) return z.NEVER;
            return { ...response, clientData };
        }),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    clientExtensionResults: z.record(z.string(), z.any()),
    type: z.literal('public-key')
}) satisfies z.ZodType<AuthenticationResponseJSON>;
export type WebAuthnAuthenticationResponse = z.infer<typeof WebAuthnAuthenticationResponseSchema>;

/**
 * WebAuthn registration response coming back from the browser.
 *
 * This schema also parses and attaches `response.clientData.challenge` for convenience.
 */
export const WebAuthnRegistrationResponseSchema = z.object({
    id: z.string(),
    rawId: z.string(),
    response: z
        .object({
            clientDataJSON: z.base64url(),
            attestationObject: z.string(),
            authenticatorData: z.string().optional(),
            transports: z.array(PasskeyTransports).optional(),
            publicKeyAlgorithm: z.number().optional(),
            publicKey: z.string().optional()
        })
        .transform((response, ctx) => {
            const clientData = parseClientDataJSONBase64Url(response.clientDataJSON, ctx);
            if (clientData === z.NEVER) return z.NEVER;
            return { ...response, clientData };
        }),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    clientExtensionResults: z.record(z.string(), z.any()),
    type: z.literal('public-key'),
    deviceName: z.string().max(100).optional()
}) satisfies z.ZodType<RegistrationResponseJSON>;
export type WebAuthnRegistrationResponse = z.infer<typeof WebAuthnRegistrationResponseSchema>;

/**
 * Decoded WebAuthn `clientDataJSON` payload.
 */
const WebAuthnClientDataSchema = z.looseObject({
    type: z.string().optional(),
    challenge: z.string().min(1),
    origin: z.string().optional(),
    crossOrigin: z.boolean().optional()
});

export const StepUpBeginRequestSchema = z.object({
    action: z.string().min(1).max(100)
});

export const StepUpFinishRequestSchema = z.object({
    action: z.string().min(1).max(100),
    assertion: WebAuthnAuthenticationResponseSchema
});

export const StepUpBeginResponseSchema = z.object({
    rpId: z.string(),
    challenge: z.string(),
    allowCredentials: z.array(WebAuthnPublicKeyCredentialSchema)
});

export const StepUpProofResponseSchema = z.object({
    proof: z.string(),
    expiresAt: z.iso.datetime()
});

export const StepUpRequiredResponseSchema = z.object({
    requiresStepUp: z.literal(true),
    action: z.string()
});

function parseClientDataJSONBase64Url(clientDataJSON: string, ctx: z.RefinementCtx) {
    let decoded: string;
    try {
        decoded = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
    } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid base64url clientDataJSON' });
        return z.NEVER;
    }

    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(decoded);
    } catch {
        ctx.addIssue({ code: 'custom', message: 'clientDataJSON must decode to valid JSON' });
        return z.NEVER;
    }

    const parsed = WebAuthnClientDataSchema.safeParse(parsedJson);
    if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'clientDataJSON has an invalid shape' });
        return z.NEVER;
    }

    return parsed.data;
}
