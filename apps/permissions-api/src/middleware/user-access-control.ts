import { type UserAccessControlDefinition, userAccessControl, userForbiddenAccessControl } from '@repo/access-control';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { createPermix } from 'permix/fastify';
import { ForbiddenError } from '../utils/error-types';

export const userFastifyPermix = createPermix<UserAccessControlDefinition>();

export const userAccessControlValidator = userFastifyPermix.plugin(({ request }) => {
    try {
        const user = request.auth.currentUser();
        return userAccessControl(user);
    } catch {
        return userForbiddenAccessControl();
    }
});

export function userAccessControlPreHandler(...params: Parameters<typeof userFastifyPermix.checkHandler>) {
    return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
        const permix = userFastifyPermix.get(request, reply);
        const hasPermission = permix.check(...params);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        done();
    };
}
