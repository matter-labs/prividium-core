import { type Hex, parseTransaction, type serializeTransaction, zeroAddress } from 'viem';
import { z } from 'zod/v4';
import { methodAccessSchema } from '../../../db/schema';
import { TransactionClassifier } from '../../../services/transaction-classifier';
import { recoverTransactionAddressNative } from '../../../utils/recover-tx-address-native';
import { addressSchema } from '../../../utils/schemas/address';
import { hexSchema } from '../../../utils/schemas/hex-schema';
import { ForbiddenRpcError, WrongArguments } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { forwardAndRecordSubmission } from '../../rpc-observer';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import type { TxData } from '../../types';
import { handleAndVerifyDeployment, isDeploy } from '../generic-handlers';

/** Helper — understands *both* canonical RLP tx (types 0,1,2,3…) */
export async function decodeTx(raw: Hex): Promise<TxData> {
    // Legacy / 2930 / 1559 / blob  :contentReference[oaicite:1]{index=1}
    const parsedTx = parseTransaction(raw);

    if (parsedTx.type === 'eip4844') {
        throw new WrongArguments('Unsupported eip4844 transaction');
    }

    // At this stage we are sure that the raw hex string is a valid tx
    // because parseTransaction worked and the tx type was validated
    const reserialized = raw as ReturnType<typeof serializeTransaction>;
    return {
        // Use the native libsecp256k1 binding instead of viem's pure-JS noble path.
        // Same result, ~10-50x faster, eliminates the recoverPublicKey CPU sink seen
        // under sustained load.
        from: await recoverTransactionAddressNative({ serializedTransaction: reserialized }),
        data: parsedTx.data ?? '0x',
        to: typeof parsedTx.to === 'string' ? parsedTx.to : undefined,
        nonce: parsedTx.nonce ?? 0,
        value: parsedTx.value ?? 0n
    };
}

const paramsSchema = z.tuple([hexSchema], z.unknown());

export const eth_sendRawTransaction: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'eth_sendRawTransaction',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [rawTx] = params;
        const tx = await decodeTx(rawTx);

        const signer = tx.from;

        const txTo = addressSchema.optional().nullable().safeParse(tx.to);
        if (!txTo.success) throw new WrongArguments();

        if (isDeploy({ to: txTo.data })) {
            return handleAndVerifyDeployment(tx, context, id, rawTx);
        }

        // A value transfer to an EOA has no method to authorize.
        const classifier = new TransactionClassifier(context.targetRpc);
        const { type } = await classifier.classifyTransaction(txTo.data ?? null, tx.data, tx.value);
        if (type === 'transfer-to-eoa') {
            return forwardAndRecordSubmission(context, id, rawTx);
        }

        const authResult = await context.authorizer.checkContractAccess(
            signer,
            txTo.data ?? zeroAddress,
            tx.data,
            methodAccessSchema.enum.write,
            method
        );

        if (!authResult.authorized) {
            throw new ForbiddenRpcError(undefined, authResult.reason, undefined, authResult.ruleId);
        }

        return forwardAndRecordSubmission(context, id, rawTx);
    }
};
