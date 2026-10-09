import { type Address, type Hex, zeroAddress } from 'viem';
import { z } from 'zod/v4';
import type { MethodAccessType } from '../../../db/schema';
import type { AuthorizationResult } from '../../../services/authorization-service';
import { areHexEqual } from '../../../utils/hex';
import { addressSchema } from '../../../utils/schemas/address';
import { blockTagSchema } from '../../../utils/schemas/block-tag';
import { hexSchema } from '../../../utils/schemas/hex-schema';
import { bigintStringSchema } from '../../../utils/schemas/numeric';
import { ForbiddenRpcError, WrongArguments } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import { authorizeDeploy, isDeploy } from './deploy-utils';

const eip712MetaSchema = z.object({
    gasPerPubdata: bigintStringSchema.or(hexSchema).optional(),
    customSignature: hexSchema.optional(),
    paymasterParams: z
        .object({
            paymaster: addressSchema,
            paymasterInput: hexSchema.or(z.array(z.number()))
        })
        .optional(),
    factoryDeps: z.array(hexSchema).optional()
});

const callReqSchema = z
    .object({
        from: addressSchema.optional(),
        to: addressSchema.nullable().optional(),
        gas: hexSchema.optional(),
        gasPrice: hexSchema.optional(),
        gas_price: hexSchema.optional(),
        maxFeePerGas: hexSchema.optional(),
        maxPriorityFeePerGas: hexSchema.optional(),
        max_fee_per_gas: hexSchema.optional(),
        max_priority_fee_per_gas: hexSchema.optional(),
        value: hexSchema.optional(),
        data: hexSchema.optional(),
        input: hexSchema.optional(),
        nonce: hexSchema.optional(),
        type: hexSchema.optional(),
        access_list: z.array(z.tuple([addressSchema, z.array(hexSchema)])).optional(),
        customData: eip712MetaSchema.optional(),
        eip712Meta: eip712MetaSchema.optional(),
        chainId: z.unknown().optional()
    })
    .strict();

const paramsSchema = z.tuple([callReqSchema], z.unknown());

export function validatedEthereumCall(
    name: string,
    stateOverrideArgPosition: number,
    accessType: MethodAccessType = 'read'
): MethodHandler<AuthorizedRpcContext, typeof paramsSchema> {
    return {
        name: name,
        paramsSchema,
        async handle(context, method, params, id): Promise<JsonRpcResponse> {
            if (params.length > stateOverrideArgPosition) {
                throw new ForbiddenRpcError('state overrides are not supported');
            }

            const [call] = params;

            // The route also admits anonymous callers; every simulation needs a principal.
            await context.authorizer.ensureUserExists();

            // Resolve the calldata the node will actually execute. zksync-os
            // (alloy `TransactionInput::into_input`) uses `input.or(data)` —
            // `input` wins when present — so authorizing on `data` while the
            // node executes `input` is a permission bypass. Mirror that
            // precedence here, and reject the ambiguous case where both fields
            // are present but differ.
            if (call.data !== undefined && call.input !== undefined && !areHexEqual(call.data, call.input)) {
                throw new WrongArguments('Conflicting "data" and "input" fields in call object');
            }
            const data = call.input ?? call.data ?? '0x';

            if (isDeploy(call)) {
                const { authorized, ruleId } = await authorizeDeploy(context, call.from || zeroAddress);
                if (authorized) {
                    return context.targetRpc.delegate(id, method, params);
                }

                throw new ForbiddenRpcError(
                    'Missing deploy permission for current user/tenant/service',
                    undefined,
                    undefined,
                    ruleId
                );
            }

            const to = call.to ?? zeroAddress;
            let forwardedParams: unknown[] = params;
            let runsNoCode = false;
            if (data === '0x') {
                const block = await pinSimulationBlock(context, id, params[1]);
                if (block !== undefined) {
                    // Empty calldata runs no code only when the target has no bytecode at that block; a
                    // contract target runs receive()/fallback(), gated by the 0x selector permission.
                    runsNoCode = !(await context.targetRpc.isContract(to, String(id), block));
                    forwardedParams = [call, block];
                }
            }
            const authResult = runsNoCode
                ? await checkFromOwnership(context, call.from)
                : await context.authorizer.checkContractAccess(call.from, to, data, accessType, method);
            if (!authResult.authorized) {
                throw new ForbiddenRpcError(
                    undefined,
                    `Permission check for method call returned false`,
                    {
                        from: call.from,
                        to: call.to,
                        data
                    },
                    authResult.ruleId
                );
            }
            return context.targetRpc.delegate(id, method, forwardedParams);
        }
    };
}

// Pins the code check and execution to one block so a deployment between them cannot run unchecked code.
// Pending and unmodeled block parameters take the permission check instead.
async function pinSimulationBlock(
    context: AuthorizedRpcContext,
    id: string | number,
    blockParam: unknown
): Promise<Hex | undefined> {
    const block = blockTagSchema.safeParse(blockParam ?? 'latest');
    if (!block.success || block.data === 'pending') {
        return undefined;
    }
    return context.targetRpc.resolveBlock(String(id), block.data);
}

// An omitted `from` simulates as the zero address, which nobody owns.
async function checkFromOwnership(
    context: AuthorizedRpcContext,
    from: Address | undefined
): Promise<AuthorizationResult> {
    if (from === undefined || (await context.authorizer.checkAddressOwnership(from))) {
        return { authorized: true };
    }
    return { authorized: false, ruleId: 'wallet.not_owned_by_user' };
}
