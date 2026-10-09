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

const SUPPORTED_TX_TYPES: ReadonlySet<string> = new Set(['legacy', 'eip2930', 'eip1559']);

export async function decodeTx(raw: Hex): Promise<TxData> {
    const parsedTx = parseTransaction(raw);

    // Fail closed: eip4844 carries blobs and eip7702 installs code on the signer via
    // authorizationList, neither of which {to, calldata, value} classification can see.
    if (parsedTx.type === undefined || !SUPPORTED_TX_TYPES.has(parsedTx.type)) {
        throw new WrongArguments(`Unsupported ${parsedTx.type ?? 'unknown'} transaction`);
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

        // A transfer to an EOA has no method to authorize. Binding the signer to the caller stops an
        // anonymous or revoked principal from moving the base token.
        const classifier = new TransactionClassifier(context.targetRpc);
        const { type } = await classifier.classifyTransaction(txTo.data ?? null, tx.data, tx.value);
        if (type === 'transfer-to-eoa') {
            if (!(await context.authorizer.checkAddressOwnership(signer))) {
                throw new ForbiddenRpcError(
                    undefined,
                    'signer is not a wallet of the caller',
                    undefined,
                    'wallet.not_owned_by_user'
                );
            }
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
