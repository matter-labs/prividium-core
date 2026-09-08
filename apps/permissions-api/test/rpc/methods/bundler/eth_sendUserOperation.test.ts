import { type Address, concat, encodeFunctionData, type Hex, pad, toHex } from 'viem';
import { describe, expect } from 'vitest';
import { ForbiddenRpcError } from '../../../../src/rpc/errors';
import { eth_sendUserOperation } from '../../../../src/rpc/methods/handlers/bundler';
import { ERC7579_CALLTYPE } from '../../../../src/rpc/methods/handlers/bundler/utils/sso-calldata';
import type { UserOperation } from '../../../../src/utils/schemas/user-operation';
import { it } from '../../test-bundler-env';
import { MOCK_BYTECODE } from '../../test-mocks';

// =============================================================================
// Test ABI Definitions
// =============================================================================

/**
 * ABI for SSO execute function - used for encoding test calldata.
 * Signature: execute(bytes32 mode, bytes calldata executionCalldata)
 */
const SSO_EXECUTE_ABI = [
    {
        name: 'execute',
        type: 'function',
        inputs: [
            { name: 'mode', type: 'bytes32' },
            { name: 'executionCalldata', type: 'bytes' }
        ],
        outputs: []
    }
] as const;

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Encodes an ERC-7579 mode bytes32 value.
 * Format: callType (1 byte) || execType (1 byte) || unused (30 bytes)
 */
function encodeMode(callType: number, execType = 0): Hex {
    const callTypeHex = callType.toString(16).padStart(2, '0');
    const execTypeHex = execType.toString(16).padStart(2, '0');
    return `0x${callTypeHex}${execTypeHex}${'0'.repeat(60)}` as Hex;
}

/**
 * Encodes a single execution for SSO execute function.
 * Uses ERC-7579 packed format: target (20 bytes) || value (32 bytes) || data
 */
function encodeExecute(target: Address, value: bigint, data: Hex): Hex {
    const mode = encodeMode(ERC7579_CALLTYPE.SINGLE);
    const executionData = concat([target, pad(toHex(value), { size: 32 }), data]);
    return encodeFunctionData({
        abi: SSO_EXECUTE_ABI,
        functionName: 'execute',
        args: [mode, executionData]
    });
}

// =============================================================================
// Tests
// =============================================================================

describe('eth_sendUserOperation', () => {
    const method = eth_sendUserOperation;
    const defaultSender = '0x1234567890123456789012345678901234567890' as Address;

    const createUserOp = (overrides: Partial<UserOperation> = {}): UserOperation => ({
        sender: defaultSender,
        nonce: '0x01',
        initCode: '0x',
        callData: '0x',
        callGasLimit: '0x30d40',
        verificationGasLimit: '0x30d40',
        preVerificationGas: '0x5208',
        maxFeePerGas: '0x989680',
        maxPriorityFeePerGas: '0xf4240',
        paymasterAndData: '0x',
        signature: '0x',
        ...overrides
    });

    const entryPoint = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108' as Address;

    describe('with valid UserOperation', () => {
        it('returns forbidden when sender is not associated with user', async ({ reqContext, authorizer }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([]); // No addresses associated
            const userOp = createUserOp();

            await expect(
                method.handle(reqContext, 'eth_sendUserOperation', [userOp, entryPoint], 'req-1')
            ).rejects.toThrow(new ForbiddenRpcError('Sender address is not associated with the authenticated user'));
        });

        it('returns forbidden when sender lacks permission for calldata', async ({ reqContext, authorizer, rpc }) => {
            authorizer.setAllowRead(false);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const targetContract = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
            const innerCallData = '0xabcdef12' as Hex;

            const callData = encodeExecute(targetContract, 0n, innerCallData);
            const userOp = createUserOp({ callData });

            await expect(
                method.handle(reqContext, 'eth_sendUserOperation', [userOp, entryPoint], 'req-1')
            ).rejects.toThrow(new ForbiddenRpcError('UserOp sender lacks permission for this operation'));
        });

        it('forwards execute call to bundler when authorized', async ({ reqContext, authorizer, bundlerRpc, rpc }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const targetContract = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
            const innerCallData = '0xabcdef12' as Hex;

            const callData = encodeExecute(targetContract, 0n, innerCallData);
            const userOp = createUserOp({ callData });
            const userOpHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

            bundlerRpc.registerDelegate('req-1', {
                jsonrpc: '2.0',
                id: 'req-1',
                result: userOpHash
            });

            const result = await method.handle(reqContext, 'eth_sendUserOperation', [userOp, entryPoint], 'req-1');

            expect(result).toMatchObject({
                result: userOpHash
            });

            // Verify bundler was called with correct params
            expect(bundlerRpc.delegateRegistry).toHaveLength(1);
            expect(bundlerRpc.delegateRegistry[0]).toMatchObject({
                id: 'req-1',
                method: 'eth_sendUserOperation'
            });
        });
    });
});
