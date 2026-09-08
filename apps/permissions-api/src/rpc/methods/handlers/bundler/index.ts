import type { z } from 'zod/v4';
import type { AuthorizedRpcContext, MethodHandler } from '../../../rpc-service';
import { eth_estimateUserOperationGas } from './eth_estimateUserOperationGas';
import { eth_getUserOperationByHash } from './eth_getUserOperationByHash';
import { eth_getUserOperationReceipt } from './eth_getUserOperationReceipt';
import { eth_sendUserOperation } from './eth_sendUserOperation';
import { eth_supportedEntryPoints } from './eth_supportedEntryPoints';

export {
    eth_estimateUserOperationGas,
    eth_getUserOperationByHash,
    eth_getUserOperationReceipt,
    eth_sendUserOperation,
    eth_supportedEntryPoints
};

export const bundlerHandlers: Array<MethodHandler<AuthorizedRpcContext, z.ZodType>> = [
    eth_sendUserOperation,
    eth_estimateUserOperationGas,
    eth_getUserOperationByHash,
    eth_getUserOperationReceipt,
    eth_supportedEntryPoints
];
