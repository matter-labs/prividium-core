/** biome-ignore-all lint/suspicious/noExplicitAny: tracer string is serialized JS executed by the node */

import { decodeAbiParameters, type Hex } from 'viem';
import { z } from 'zod/v4';
import { hexSchema } from '../../../utils/schemas/hex-schema';
import { ForbiddenRpcError } from '../../errors';
import { errorResponse, response } from '../../json-rpc';
import type { AnyParams } from '../../params-schemas';
import { anyParams } from '../../params-schemas';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';

// JSON-RPC execution revert error code (EIP-1474).
const EXECUTION_REVERT_CODE = 3;

// Selector of the standard Solidity `Error(string)` (revert reason) — when a
// revert payload starts with this, the rest is the ABI-encoded reason string.
const ERROR_STRING_SELECTOR = '0x08c379a0';

// Minimal custom tracer: captures whether the call failed and the raw return
// value (the revert payload on failure). Injected into debug_traceCall so the
// sequencer runs the simulation without engaging the TxValidator, which would
// deny calls whose `from` is not a registered Prividium user.
const callResultTracerStr = `{
    result: function(ctx, _db) {
        return {
            failed: !!ctx.error,
            returnValue: ctx.output || '0x'
        };
    },
    fault: function(_log, _db) {}
}`;

const callResultSchema = z.object({
    failed: z.boolean(),
    returnValue: hexSchema
});

/**
 * Try to decode the revert payload as the standard Solidity `Error(string)`.
 * Returns the reason string when the payload matches that shape, otherwise
 * undefined — custom errors and bare panics fall through to a generic
 * `execution reverted` message and rely on the caller decoding `data`.
 */
function tryDecodeRevertReason(data: Hex): string | undefined {
    if (!data.startsWith(ERROR_STRING_SELECTOR) || data.length < 138) {
        return undefined;
    }
    try {
        const [reason] = decodeAbiParameters([{ type: 'string' }], `0x${data.slice(10)}` as Hex);
        return reason;
    } catch {
        return undefined;
    }
}

/**
 * eth_call handler for full-sequencer-access users.
 *
 * Behavior is gated on whether the TxValidator policy listener is active
 * (`POLICY_PORT` set):
 *
 * - **Listener enabled** — full-access users may submit eth_call with an
 *   arbitrary `from` address. Forwarding directly would trigger the chain's
 *   judge endpoint, which denies with `user.not_found` because the address
 *   isn't a registered Prividium user. Rewrite the call to `debug_traceCall`
 *   with a minimal custom tracer; debug_traceCall bypasses the validator
 *   entirely. State overrides are forwarded inside the tracer options
 *   object. Reverts surface as a generic execution-revert error.
 *
 * - **Listener disabled** — there is no validator to bypass; the chain
 *   isn't talking to admit/judge at all. Forward eth_call directly to keep
 *   pre-policy-feature behavior.
 */
export const fullSequencerAccessEthCall: MethodHandler<AuthorizedRpcContext, AnyParams> = {
    name: 'eth_call',
    paramsSchema: anyParams,
    async handle(context, method, params, id) {
        if (!(await context.authorizer.hasFullSequencerAccess())) {
            throw new ForbiddenRpcError('Expected user to have full sequencer access');
        }

        if (!context.policyEnabled) {
            return context.targetRpc.delegate(id, method, params);
        }

        const [callObject, blockTag = 'latest', stateOverrides] = params;

        const traceOptions: Record<string, unknown> = { tracer: callResultTracerStr };
        if (stateOverrides !== undefined) {
            traceOptions.stateOverrides = stateOverrides;
        }

        const result = await context.targetRpc.send(
            id,
            'debug_traceCall',
            [callObject, blockTag, traceOptions],
            callResultSchema
        );

        if (result.failed) {
            const data = result.returnValue;
            const reason = tryDecodeRevertReason(data);
            return errorResponse({
                id,
                error: {
                    code: EXECUTION_REVERT_CODE,
                    message: reason ? `execution reverted: ${reason}` : 'execution reverted',
                    data
                }
            });
        }

        return response({ id, result: result.returnValue });
    }
};
