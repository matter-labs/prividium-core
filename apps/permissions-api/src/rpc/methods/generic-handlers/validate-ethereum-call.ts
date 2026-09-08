import { type Hex, toFunctionSelector, zeroAddress } from 'viem';
import { z } from 'zod/v4';
import type { MethodAccessType } from '../../../db/schema';
import { areHexEqual } from '../../../utils/hex';
import { addressSchema } from '../../../utils/schemas/address';
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

const whitelistedMethods: Hex[] = [toFunctionSelector('eip712Domain()')];

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

            const authResult =
                data === '0x' || whitelistedMethods.includes(data)
                    ? undefined
                    : await context.authorizer.checkContractAccess(
                          call.from,
                          call.to ?? zeroAddress,
                          data,
                          accessType,
                          method
                      );
            if (authResult && !authResult.authorized) {
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
            return context.targetRpc.delegate(id, method, params);
        }
    };
}
