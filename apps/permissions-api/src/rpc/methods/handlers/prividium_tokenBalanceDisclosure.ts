import { encodeFunctionData, parseAbiItem, zeroAddress } from 'viem';
import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { blockTagSchema } from '../../../utils/schemas/block-tag';
import { ForbiddenRpcError } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { response } from '../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import { ethCallDisclosure } from './eth-call-disclosure';

const paramsSchema = z.tuple([addressSchema, addressSchema, blockTagSchema]);

const balanceOfAbi = [parseAbiItem('function balanceOf(address _owner) public view returns (uint256 balance)')];

/**
 * Selective disclosure methods do not require a valid jwt.
 */
export const prividium_tokenBalanceDisclosure: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'prividium_tokenBalanceDisclosure',
    paramsSchema,
    async handle(context, _method, params, id): Promise<JsonRpcResponse> {
        const [tokenAddress, holderAddress, blockTag] = params;

        const disclosure = await context.authorizer.getTokenBalanceDisclosureConfig(tokenAddress, holderAddress);
        if (!disclosure) {
            throw new ForbiddenRpcError(
                `Balance disclosure not enabled for address ${holderAddress} on contract ${tokenAddress}`
            );
        }

        const callData = encodeFunctionData({
            abi: balanceOfAbi,
            functionName: 'balanceOf',
            args: [holderAddress]
        });

        const result = await ethCallDisclosure(context, id, tokenAddress, callData, blockTag, disclosure, zeroAddress);
        return response({ id, result });
    }
};
