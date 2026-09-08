import { z } from 'zod/v4';
import { addressSchema } from '../../../../utils/schemas/address';
import { hexSchema } from '../../../../utils/schemas/hex-schema';
import type { JsonRpcResponse } from '../../../json-rpc';
import { response } from '../../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../../rpc-service';
import { isBundlerContext } from './utils/is-bundler-context';

// ERC-4337 eth_getUserOperationByHash response schema
// Contains the UserOperation with sender address for access control
const UserOperationByHashResponseSchema = z
    .looseObject({
        userOperation: z.looseObject({
            sender: addressSchema
        })
    })
    .nullable();

const paramsSchema = z.tuple([hexSchema], z.unknown());

export const eth_getUserOperationByHash: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'eth_getUserOperationByHash',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        // 0. Ensure bundler is enabled
        isBundlerContext(context);

        // 1. Fetch UserOperation and associated addresses in parallel
        const [associatedAddresses, userOpResult] = await Promise.all([
            context.authorizer.associatedAddresses(),
            context.bundlerRpc.send(id, method, params, UserOperationByHashResponseSchema)
        ]);

        // 2. If not found, return null
        if (!userOpResult) {
            return response({ id, result: null });
        }

        // 3. Check if sender is associated with the user
        const isAssociated = associatedAddresses.has(userOpResult.userOperation.sender);

        return response({ id, result: isAssociated ? userOpResult : null });
    }
};
