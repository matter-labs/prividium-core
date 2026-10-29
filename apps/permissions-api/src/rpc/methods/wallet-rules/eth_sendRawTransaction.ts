import { z } from 'zod/v4';
import { EIP_7966_TIMEOUT_CODE } from '#rpc/constants';
import { ForbiddenRpcError, RpcException, WrongArguments } from '#rpc/errors';
import type { JsonRpcResponse } from '#rpc/json-rpc';
import { handleContractDeployment, isDeploy } from '#rpc/methods/generic-handlers/index';
import { decodeTx } from '#rpc/methods/handlers/eth_sendRawTransaction';
import { forwardAndRecordSubmission } from '#rpc/rpc-observer';
import type { MethodHandler, WalletContext } from '#rpc/rpc-service';
import type { TxData } from '#rpc/types';
import { hexSchema } from '#utils/schemas/hex-schema';

const paramsSchema = z.tuple([hexSchema], z.unknown());

// Handler for sendRawTransaction that validates against transaction allowances
export const eth_sendRawTransaction: MethodHandler<WalletContext, typeof paramsSchema> = {
    name: 'eth_sendRawTransaction',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [rawTx] = params;

        let tx: TxData;
        try {
            tx = await decodeTx(rawTx);
        } catch (e) {
            if (e instanceof RpcException) throw e;
            throw new WrongArguments('Invalid transaction format or cannot recover sender address');
        }

        const authResult = await context.walletAuthorizer.checkTransactionAllowed(
            tx.from,
            tx.to ?? null,
            tx.nonce,
            tx.data,
            tx.value,
            method
        );
        if (!authResult.authorized) {
            throw new ForbiddenRpcError('Transaction not authorized', authResult.reason, undefined, authResult.ruleId);
        }

        let txResponse: JsonRpcResponse;
        if (isDeploy(tx)) {
            txResponse = await handleContractDeployment(tx, context, id, rawTx, context.walletAuthorizer.userId);
        } else {
            txResponse = await forwardAndRecordSubmission(context, id, rawTx);
        }

        // Store the tx hash on success and on EIP-7966 timeout. Timeout means
        // the tx is admitted to the mempool and may still mine. The wallet
        // RPC's eth_getTransactionReceipt polls the stored hash, so without
        // this the user would be told to poll but the wallet would keep
        // returning null.
        const isSuccess = !('error' in txResponse) && typeof txResponse.result === 'string';
        const isTimeout = 'error' in txResponse && txResponse.error.code === EIP_7966_TIMEOUT_CODE;
        if (isSuccess || isTimeout) {
            await context.walletAuthorizer.updateTransactionHash(rawTx).catch((err: Error) => {
                context.logger.error({ err }, 'Failed to update transaction hash');
            });
        }

        return txResponse;
    }
};
