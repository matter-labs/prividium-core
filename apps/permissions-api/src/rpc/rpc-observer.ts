import type { Hex } from 'viem';
import { EIP_7966_TIMEOUT_CODE, SEQUENCER_RATE_LIMIT_ERROR_CODE } from './constants';
import type { JsonRpcResponse } from './json-rpc';
import type { BaseContext } from './rpc-service';

/**
 * Forwards a raw tx and tells the observer how the sequencer answered. An EIP-7966
 * timeout counts as accepted (still in the mempool); a rate limit is throttled, not
 * rejected — the tx never reached the mempool and the caller was told to retry; any
 * other error is a sequencer rejection.
 */
export async function forwardAndRecordSubmission(
    context: Pick<BaseContext, 'targetRpc' | 'rpcObserver'>,
    id: string | number,
    rawTx: Hex
): Promise<JsonRpcResponse> {
    const response = await context.targetRpc.submitRawTransaction(id, rawTx);
    if (context.rpcObserver) {
        if (!('error' in response) || response.error.code === EIP_7966_TIMEOUT_CODE) {
            context.rpcObserver.recordSubmission(rawTx);
        } else if (response.error.code === SEQUENCER_RATE_LIMIT_ERROR_CODE) {
            context.rpcObserver.recordThrottled(rawTx, response.error.code);
        } else {
            context.rpcObserver.recordRejection(rawTx, response.error.code);
        }
    }
    return response;
}
