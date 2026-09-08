import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { hexSchema } from '../../../utils/schemas/hex-schema';
import type { JsonRpcResponse } from '../../json-rpc';
import { forwardAndRecordSubmission } from '../../rpc-observer';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import { handleAndVerifyDeployment, isDeploy } from '../generic-handlers';
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
