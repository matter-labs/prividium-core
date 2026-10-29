import { z } from 'zod/v4';
import type { JsonRpcResponse } from '#rpc/json-rpc';
import { handleAndVerifyDeployment, isDeploy } from '#rpc/methods/generic-handlers/index';
import { forwardAndRecordSubmission } from '#rpc/rpc-observer';
import type { AuthorizedRpcContext, MethodHandler } from '#rpc/rpc-service';
import { addressSchema } from '#utils/schemas/address';
import { hexSchema } from '#utils/schemas/hex-schema';
import { decodeTx } from './eth_sendRawTransaction';

const paramsSchema = z.tuple([hexSchema], z.unknown());

export const fullSequencerAccessBroadcastTx: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'eth_sendRawTransaction',
    paramsSchema,
    async handle(context, _method, params, id): Promise<JsonRpcResponse> {
        const [rawTx] = params;
        const tx = await decodeTx(rawTx);
        const txTo = addressSchema.optional().nullable().safeParse(tx.to);

        if (isDeploy({ to: txTo.data })) {
            return handleAndVerifyDeployment(tx, context, id, rawTx);
        }

        // Full-sequencer txs skip proxy checks; on zksync-os they still hit
        // /admit + /judge on the chain side.
        return forwardAndRecordSubmission(context, id, rawTx);
    }
};
