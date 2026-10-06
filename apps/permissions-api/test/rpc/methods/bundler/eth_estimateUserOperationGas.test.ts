import type { Address } from 'viem';
import { describe, expect } from 'vitest';
import { ForbiddenRpcError } from '../../../../src/rpc/errors';
import { eth_estimateUserOperationGas } from '../../../../src/rpc/methods/handlers/bundler';
import type { UserOperation } from '../../../../src/utils/schemas/user-operation';
import { it } from '../../test-bundler-env';

describe('eth_estimateUserOperationGas', () => {
    const method = eth_estimateUserOperationGas;
    const sender = '0x1234567890123456789012345678901234567890' as Address;
    const entryPoint = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108' as Address;
    const target = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;

    const userOp: UserOperation = {
        sender,
        nonce: '0x01',
        initCode: '0x',
        callData: '0x',
        callGasLimit: '0x30d40',
        verificationGasLimit: '0x30d40',
        preVerificationGas: '0x5208',
        maxFeePerGas: '0x989680',
        maxPriorityFeePerGas: '0xf4240',
        paymasterAndData: '0x',
        signature: '0x'
    };

    it('refuses a state override before anything reaches the bundler', async ({
        reqContext,
        authorizer,
        bundlerRpc
    }) => {
        authorizer.setUserAddresses([sender]);
        const params = method.paramsSchema.parse([userOp, entryPoint, { [target]: { code: '0x60006000' } }]);

        await expect(method.handle(reqContext, 'eth_estimateUserOperationGas', params, 'req-1')).rejects.toThrow(
            new ForbiddenRpcError('state overrides are not supported')
        );
        expect(bundlerRpc.delegateRegistry).toEqual([]);
    });

    it('lets an estimate without overrides through to the permission checks', async ({ reqContext, authorizer }) => {
        authorizer.setUserAddresses([]);

        await expect(
            method.handle(reqContext, 'eth_estimateUserOperationGas', [userOp, entryPoint], 'req-1')
        ).rejects.toThrow(new ForbiddenRpcError('Sender address is not associated with the authenticated user'));
    });
});
