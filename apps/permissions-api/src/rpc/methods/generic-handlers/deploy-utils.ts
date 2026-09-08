import { type Address, getContractAddress, type Hex, keccak256, zeroAddress } from 'viem';
import { SUBMISSION_CONFIRMS_INCLUSION } from '../../../utils/target-chain';
import { EIP_7966_TIMEOUT_CODE, INTERNAL_RPC_ERROR } from '../../constants';
import type { ContractDeploymentContext } from '../../contract-deployment-context';
import { ForbiddenRpcError, RpcException } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { forwardAndRecordSubmission } from '../../rpc-observer';
import type { AuthorizedRpcContext, BaseContext } from '../../rpc-service';
import type { TxData } from '../../types';

export function isDeploy(call: { to?: Hex | null }) {
    return call.to === null || call.to === undefined;
}

export function authorizeDeploy(context: AuthorizedRpcContext, from: Hex) {
    return context.authorizer.authorizeDeployment((from || zeroAddress) as Address);
}

export async function handleAndVerifyDeployment(
    tx: TxData,
    context: AuthorizedRpcContext,
    id: string | number,
    rawTx: Hex
) {
    const { authorized, ruleId, deployerUserId } = await authorizeDeploy(context, tx.from);
    if (!authorized || deployerUserId === undefined) {
        throw new ForbiddenRpcError(undefined, undefined, undefined, ruleId);
    }
    return handleContractDeployment(tx, context, id, rawTx, deployerUserId);
}

export async function handleContractDeployment(
    tx: TxData,
    context: BaseContext,
    id: string | number,
    rawTx: Hex,
    deployerUserId: string
): Promise<JsonRpcResponse> {
    if (!context.deployment) {
        throw new RpcException('Internal server error', INTERNAL_RPC_ERROR, 'missing configuration for deployments');
    }
    const deploymentHooks = context.deployment as unknown as ContractDeploymentContext;

    const data = {
        address: getContractAddress({ from: tx.from as Address, nonce: BigInt(tx.nonce) }),
        deployerAddress: tx.from,
        deployerNonce: tx.nonce,
        deployTxHash: keccak256(rawTx),
        startedAt: new Date()
    };

    return deploymentHooks.recordedDeploy<JsonRpcResponse>(data, deployerUserId, async () => {
        const targetRpcResponse = await forwardAndRecordSubmission(context, id, rawTx);

        if ('error' in targetRpcResponse) {
            if (targetRpcResponse.error.code !== EIP_7966_TIMEOUT_CODE) {
                throw new Error(targetRpcResponse.error.message);
            }
            return { result: targetRpcResponse, confirmed: false };
        }

        return { result: targetRpcResponse, confirmed: SUBMISSION_CONFIRMS_INCLUSION[context.targetRpc.chainType] };
    });
}
