import { z } from 'zod/v4';
import { userOperationSchema } from '../../../../utils/schemas/user-operation';
import { ForbiddenRpcError } from '../../../errors';
import type { JsonRpcResponse } from '../../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../../rpc-service';
import { isBundlerContext } from './utils/is-bundler-context';
import { validateUserOpPermissions } from './utils/validate-user-op';

const paramsSchema = z.tuple([userOperationSchema], z.unknown());

export const eth_estimateUserOperationGas: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'eth_estimateUserOperationGas',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        // 0. Ensure bundler is enabled
        isBundlerContext(context);

        // 1. Extract validated UserOp
        const [userOp] = params;

        // 2. Validate UserOp callData against sender's permissions
        // The sender address must be linked to the authenticated user's account
        const validationResult = await validateUserOpPermissions(context, userOp, method);
        if (!validationResult.authorized) {
            throw new ForbiddenRpcError(validationResult.error);
        }

        // 3. Forward to bundler for gas estimation
        return context.bundlerRpc.delegate(id, method, params);
    }
};
