import { AUDIT_ACTIONS } from '@repo/access-control';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { requireStepUpIfApplicable } from '../middleware/require-step-up';
import type { StepUpService } from '../services/step-up-service';
import { EntityNotFound, ForbiddenError } from '../utils/error-types';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';
import { StepUpRequiredResponseSchema } from '../utils/schemas/webauthn';
import { CredentialSchema } from './schemas/webauthn';

export const PASSKEY_ADMIN_DELETE_STEP_UP_ACTION = 'passkey:admin-delete';
export const PASSKEY_ADMIN_RESET_STEP_UP_ACTION = 'passkey:admin-reset';

interface WebAuthnAdminRoutesDeps {
    stepUpService: StepUpService;
}

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

export function webauthnAdminRoutes(server: FastifyServer, { stepUpService }: WebAuthnAdminRoutesDeps) {
    // true only for cross-admin mutations where the acting admin has ≥1 passkey
    const crossUserWithActorPasskey = async (req: FastifyRequest) => {
        const actor = req.auth.currentUser();
        const { userId } = req.params as { userId: string };
        if (userId === actor.id) return false;
        const count = await req.repos.passkeyCredentials.countByUserId(actor.id);
        return count > 0;
    };
    server.get(
        '/users/:userId',
        {
            schema: {
                description: 'List all passkeys for a user (admin only)',
                tags: ['webauthn', 'admin'],
                params: z.object({ userId: z.string() }),
                response: {
                    200: z.object({ items: z.array(CredentialSchema) }),
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const { userId } = req.params;

            const user = await req.repos.users.findById(userId);
            if (!user) {
                throw new EntityNotFound('User', { id: userId });
            }

            const credentials = await req.repos.passkeyCredentials.findByUserId(userId);
            return { items: credentials.map(formatCredential) };
        }
    );

    server.delete(
        '/users/:userId/:credentialId',
        {
            preHandler: requireStepUpIfApplicable(PASSKEY_ADMIN_DELETE_STEP_UP_ACTION, crossUserWithActorPasskey, {
                stepUpService
            }),
            config: { audit_action: AUDIT_ACTIONS.PASSKEY_DELETE },
            schema: {
                description: 'Delete a specific passkey for a user (admin only)',
                tags: ['webauthn', 'admin'],
                params: z.object({ userId: z.string(), credentialId: z.string() }),
                response: {
                    204: z.undefined(),
                    401: z.union([ErrorResponseSchema, StepUpRequiredResponseSchema]),
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const { userId, credentialId } = req.params;

            const user = await req.repos.users.findById(userId);
            if (!user) {
                throw new EntityNotFound('User', { id: userId });
            }

            const passkeyRepo = req.repos.passkeyCredentials;
            const credential = await passkeyRepo.findById(credentialId);
            if (!credential || credential.userId !== userId) {
                throw new EntityNotFound('Passkey credential', { id: credentialId });
            }

            const currentUser = req.auth.currentUser();
            if (userId === currentUser.id) {
                const result = await passkeyRepo.deleteIfNotLast(credentialId, userId);
                if (result === 'last') {
                    throw new ForbiddenError('Cannot delete your last passkey as an admin. MFA is required.');
                }
                if (result === 'not_found') {
                    throw new EntityNotFound('Passkey credential', { id: credentialId });
                }
            } else {
                await passkeyRepo.deleteById(credentialId);
            }
            return reply.status(204).send();
        }
    );

    server.delete(
        '/users/:userId',
        {
            preHandler: requireStepUpIfApplicable(PASSKEY_ADMIN_RESET_STEP_UP_ACTION, crossUserWithActorPasskey, {
                stepUpService
            }),
            config: { audit_action: AUDIT_ACTIONS.PASSKEY_ADMIN_RESET_ALL },
            schema: {
                description: 'Reset all passkeys for a user (admin only)',
                tags: ['webauthn', 'admin'],
                params: z.object({ userId: z.string() }),
                response: {
                    200: z.object({ deletedCount: z.number() }),
                    401: z.union([ErrorResponseSchema, StepUpRequiredResponseSchema]),
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req) => {
            const { userId } = req.params;

            const user = await req.repos.users.findById(userId);
            if (!user) {
                throw new EntityNotFound('User', { id: userId });
            }

            const currentUser = req.auth.currentUser();
            if (userId === currentUser.id) {
                throw new ForbiddenError('Cannot reset your own passkeys as an admin. MFA is required.');
            }

            const passkeyRepo = req.repos.passkeyCredentials;
            const deletedCount = await passkeyRepo.deleteAllByUserId(userId);
            return { deletedCount };
        }
    );
}
