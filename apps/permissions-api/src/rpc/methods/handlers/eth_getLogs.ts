import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { hexSchema, hexSizedSchema } from '../../../utils/schemas/hex-schema';
import type { JsonRpcResponse } from '../../json-rpc';
import { response } from '../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';

const responseSchema = z.array(
    z
        .object({
            address: hexSchema,
            topics: z.array(hexSchema)
        })
        .loose()
);

const topicValueSchema = hexSizedSchema(32);
const topicFilterSchema = z.union([z.null(), topicValueSchema, z.array(topicValueSchema)]);

export const getLogsFilterSchema = z
    .object({
        fromBlock: z.unknown().optional(),
        toBlock: z.unknown().optional(),
        address: z.union([addressSchema, z.array(addressSchema)]).optional(),
        topics: z.array(topicFilterSchema).max(4).optional(),
        blockHash: hexSizedSchema(32).optional()
    })
    .loose();

export type GetLogsFilter = z.infer<typeof getLogsFilterSchema>;

const paramsSchema = z.tuple([getLogsFilterSchema]);

export const eth_getLogs: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'eth_getLogs',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [filter] = params;

        // 1. Full read access bypasses all checks
        const [hasFullRead, hasRpcMethodPermission] = await Promise.all([
            context.authorizer.hasFullReadAccess(),
            context.authorizer.hasRpcMethodPermission(method)
        ]);
        if (hasFullRead || hasRpcMethodPermission) {
            const data = await context.targetRpc.send(id, method, params, responseSchema);
            return response({ id, result: data });
        }

        // 2. Check if query could match any of user's permissions (pre-flight)
        const couldMatch = await context.authorizer.couldQueryMatchPermissions(filter);
        if (!couldMatch) {
            return response({ id, result: [] });
        }

        // 3. Query could match some permissions - call sequencer and filter
        const data = await context.targetRpc.send(id, method, params, responseSchema);
        const filtered = await context.authorizer.checkBatchEventRead(data);

        return response({ id, result: filtered });
    }
};
