import { AUDIT_ACTIONS, requiresMfa } from '@repo/access-control';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { requireStepUpIfApplicable } from '../middleware/require-step-up';
import type { PasskeyService } from '../services/passkey-service';
import type { StepUpService } from '../services/step-up-service';
import { EntityNotFound, ForbiddenError, InvalidInputError } from '../utils/error-types';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import {
    StepUpRequiredResponseSchema,
    WebAuthnRegistrationOptionsSchema,
    WebAuthnRegistrationResponseSchema
} from '../utils/schemas/webauthn';
import { CredentialSchema } from './schemas/webauthn';

interface WebAuthnUserRoutesDeps {
    passkeyService: PasskeyService;
    stepUpService: StepUpService;
}

export const PASSKEY_REGISTER_STEP_UP_ACTION = 'passkey:register';

type CredentialResponse = z.infer<typeof CredentialSchema>;

function formatCredential(c: {
    id: string;
    credentialId: string;
    deviceName: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
}): CredentialResponse {
    return {
        id: c.id,
        credentialId: c.credentialId,
        deviceName: c.deviceName,
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString()
    };
}

export function webauthnUserRoutes(server: FastifyServer, { passkeyService, stepUpService }: WebAuthnUserRoutesDeps) {
    server.post(
        '/webauthn/register/begin',
        {
            preHandler: requireStepUpIfApplicable(
                PASSKEY_REGISTER_STEP_UP_ACTION,
                async (req) => {
                    const count = await req.repos.passkeyCredentials.countByUserId(req.auth.currentUser().id);
                    return count > 0;
                },
                { stepUpService }
            ),
            config: { audit_action: AUDIT_ACTIONS.PASSKEY_REGISTER_BEGIN },
            schema: {
                description: 'Begin passkey registration for the authenticated user',
                tags: ['webauthn'],
                response: {
                    200: WebAuthnRegistrationOptionsSchema,
                    400: ErrorResponseSchema,
                    401: z.union([ErrorResponseSchema, StepUpRequiredResponseSchema]),
                    429: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const user = req.auth.currentUser();
            const userName = user.displayName ?? user.oidcSub ?? user.id;

            const existingCredentials = await req.repos.passkeyCredentials.findByUserId(user.id);
            return passkeyService.beginRegistration({
                userId: user.id,
                userName,
                existingCredentials: existingCredentials.map((c) => ({
                    credentialId: c.credentialId,
                    transports: c.transports
                }))
            });
        }
    );

    server.post(
        '/webauthn/register/finish',
        {
            config: { audit_action: AUDIT_ACTIONS.PASSKEY_REGISTER },
            schema: {
                description: 'Complete passkey registration for the authenticated user',
                tags: ['webauthn'],
                body: z.object({
                    response: WebAuthnRegistrationResponseSchema,
                    deviceName: z.string().max(100).optional()
                }),
                response: {
                    200: CredentialSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const user = req.auth.currentUser();
            const { response, deviceName } = req.body;

            const result = await passkeyService.finishRegistration({
                userId: user.id,
                response,
                deviceName: deviceName ?? null
            });
            return formatCredential(result.credential);
        }
    );

    server.get(
        '/webauthn/credentials',
        {
            schema: {
                description: 'List all passkeys for the authenticated user',
                tags: ['webauthn'],
                response: {
                    200: z.array(CredentialSchema),
                    401: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const user = req.auth.currentUser();
            const credentials = await req.repos.passkeyCredentials.findByUserId(user.id);
            return credentials.map(formatCredential);
        }
    );

    server.put(
        '/webauthn/credentials/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.PASSKEY_UPDATE },
            schema: {
                description: 'Update a passkey',
                tags: ['webauthn'],
                params: z.object({ id: z.string() }),
                body: z.object({ deviceName: z.string().max(100) }),
                response: {
                    200: CredentialSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const user = req.auth.currentUser();
            const { id } = req.params;

            const credential = await req.repos.passkeyCredentials.findById(id);
            if (!credential) {
                throw new EntityNotFound('PasskeyCredential', { id });
            }
            if (credential.userId !== user.id) {
                throw new ForbiddenError();
            }

            const updated = await req.repos.passkeyCredentials.updateById(id, req.body);
            return formatCredential(updated);
        }
    );

    server.delete(
        '/webauthn/credentials/:id',
        {
            config: { audit_action: AUDIT_ACTIONS.PASSKEY_DELETE },
            schema: {
                description: 'Delete a passkey (blocked if it is the last passkey of an MFA-required account)',
                tags: ['webauthn'],
                params: z.object({ id: z.string() }),
                response: {
                    204: z.null(),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const user = req.auth.currentUser();
            const { id } = req.params;

            const credential = await req.repos.passkeyCredentials.findById(id);
            if (!credential) {
                throw new EntityNotFound('PasskeyCredential', { id });
            }
            if (credential.userId !== user.id) {
                throw new ForbiddenError();
            }

            if (requiresMfa(user)) {
                const result = await req.repos.passkeyCredentials.deleteIfNotLast(id, user.id);
                if (result === 'last') {
                    throw new InvalidInputError(
                        'Cannot delete your last passkey while MFA is required for your account.'
                    );
                }
                if (result === 'not_found') {
                    throw new EntityNotFound('PasskeyCredential', { id });
                }
            } else {
                await req.repos.passkeyCredentials.deleteById(id);
            }

            return reply.status(204).send(null);
        }
    );
}
