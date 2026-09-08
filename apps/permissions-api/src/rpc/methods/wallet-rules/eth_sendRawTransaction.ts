import { type Address, parseTransaction, type SerializedTransactionReturnType } from 'viem';
import { z } from 'zod/v4';
import { recoverTransactionAddressNative } from '../../../utils/recover-tx-address-native';
import { hexSchema } from '../../../utils/schemas/hex-schema';
import { EIP_7966_TIMEOUT_CODE } from '../../constants';
import { ForbiddenRpcError, WrongArguments } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { forwardAndRecordSubmission } from '../../rpc-observer';
import type { MethodHandler, WalletContext } from '../../rpc-service';
import { handleContractDeployment, isDeploy } from '../generic-handlers';

const paramsSchema = z.tuple([hexSchema], z.unknown());

// Handler for sendRawTransaction that validates against transaction allowances
export const eth_sendRawTransaction: MethodHandler<WalletContext, typeof paramsSchema> = {
    name: 'eth_sendRawTransaction',
    paramsSchema,
    async handle(context, method, params, id): Promise<JsonRpcResponse> {
        const [rawTx] = params;

        // Decode the transaction to get nonce, data (calldata), to, and from address
        let transaction: ReturnType<typeof parseTransaction>;
        let from: Address;
        try {
            transaction = parseTransaction(rawTx);
            from = await recoverTransactionAddressNative({
                serializedTransaction: rawTx as SerializedTransactionReturnType
            });
        } catch {
            throw new WrongArguments('Invalid transaction format or cannot recover sender address');
        }

        const to = transaction.to ?? null;
        const nonce = transaction.nonce || 0;
        const calldata = transaction.data || '0x';
        const value = transaction.value || 0n;

        // Check if transaction is allowed using wallet authorizer
        const authResult = await context.walletAuthorizer.checkTransactionAllowed(
            from,
            to,
            nonce,
            calldata,
            value,
            method
        );
        if (!authResult.authorized) {
            throw new ForbiddenRpcError('Transaction not authorized', authResult.reason, undefined, authResult.ruleId);
        }

        let txResponse: JsonRpcResponse;
        if (isDeploy(transaction)) {
            txResponse = await handleContractDeployment(
                {
                    from,
                    to: transaction.to ?? undefined,
                    data: transaction.data ?? '0x',
                    nonce: transaction.nonce ?? 0,
                    value
                },
                context,
                id,
                rawTx,
                context.walletAuthorizer.userId
            );
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
