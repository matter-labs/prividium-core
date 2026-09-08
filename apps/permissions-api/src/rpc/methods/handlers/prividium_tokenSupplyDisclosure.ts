import { encodeFunctionData, parseAbiItem, zeroAddress } from 'viem';
import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { blockTagSchema } from '../../../utils/schemas/block-tag';
import { ForbiddenRpcError } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { response } from '../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import { ethCallDisclosure } from './eth-call-disclosure';

const paramsSchema = z.tuple([addressSchema, blockTagSchema]);

const totalSupplyAbi = [parseAbiItem('function totalSupply() public view returns (uint256)')];

/**
 * Selective disclosure methods do not require a valid jwt.
 */
export const prividium_tokenSupplyDisclosure: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'prividium_tokenSupplyDisclosure',
    paramsSchema,
    async handle(context, _method, params, id): Promise<JsonRpcResponse> {
        const [tokenAddress, blockTag] = params;

        const disclosure = await context.authorizer.getTokenSupplyDisclosureConfig(tokenAddress);
        if (!disclosure) {
            throw new ForbiddenRpcError(`Token supply disclosure not enabled for address ${tokenAddress}`);
        }

        const callData = encodeFunctionData({
            abi: totalSupplyAbi,
            functionName: 'totalSupply'
        });

        const result = await ethCallDisclosure(context, id, tokenAddress, callData, blockTag, disclosure, zeroAddress);
        return response({ id, result });
    }
};
