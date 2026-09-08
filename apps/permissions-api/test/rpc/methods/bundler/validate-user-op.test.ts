import { type Address, concat, encodeAbiParameters, encodeFunctionData, type Hex, pad, toHex } from 'viem';
import { describe, expect } from 'vitest';
import { ERC7579_CALLTYPE } from '../../../../src/rpc/methods/handlers/bundler/utils/sso-calldata';
import { validateUserOpPermissions } from '../../../../src/rpc/methods/handlers/bundler/utils/validate-user-op';
import type { UserOperation } from '../../../../src/utils/schemas/user-operation';
import { bundlerUnitTest as it } from '../../rpc-unit-test-utils';
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

/**
 * ABI for encoding ERC-7579 batch calls.
 * Structure: Call[] where Call = (address target, uint256 value, bytes data)
 */
const ERC7579_BATCH_CALL_ABI = [
    {
        type: 'tuple[]',
        components: [
            { name: 'target', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' }
        ]
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

/**
 * Encodes a batch execution for SSO execute function.
 * Uses ERC-7579 ABI-encoded Call[] format.
 */
function encodeExecuteBatch(calls: Array<{ target: Address; value: bigint; data: Hex }>): Hex {
    const mode = encodeMode(ERC7579_CALLTYPE.BATCH);
    const executionData = encodeAbiParameters(ERC7579_BATCH_CALL_ABI, [calls]);
    return encodeFunctionData({
        abi: SSO_EXECUTE_ABI,
        functionName: 'execute',
        args: [mode, executionData]
    });
}

// =============================================================================
// Tests
// =============================================================================

describe('validateUserOpPermissions', () => {
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

    describe('sender validation', () => {
        it('rejects when sender is not in user associated addresses', async ({ reqContext, authorizer }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([]); // No addresses associated
            const userOp = createUserOp();

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
            expect(!result.authorized && result.error).toBe(
                'Sender address is not associated with the authenticated user'
            );
        });

        it('allows when sender is in user associated addresses', async ({ reqContext, authorizer, rpc }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const callData = encodeExecute(
                '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address,
                0n,
                '0xabcdef12' as Hex
            );
            const userOp = createUserOp({ callData });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(true);
        });
    });

    describe('with paymaster (not yet supported)', () => {
        it('returns error when paymasterAndData is non-empty', async ({ reqContext, authorizer }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            const userOp = createUserOp({
                paymasterAndData: '0x1234567890123456789012345678901234567890' as Hex
            });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
            expect(!result.authorized && result.error).toBe('Paymaster is not yet supported');
        });
    });

    describe('with initCode/factory (not yet supported)', () => {
        it('returns error when initCode is non-empty', async ({ reqContext, authorizer }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            const userOp = createUserOp({
                initCode: '0x1234567890123456789012345678901234567890abcdef' as Hex
            });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
            expect(!result.authorized && result.error).toBe('Account factory (initCode) is not yet supported');
        });
    });

    describe('with empty callData', () => {
        it('rejects empty callData as invalid format', async ({ reqContext, authorizer, rpc }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const userOp = createUserOp({ callData: '0x' });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
            expect(!result.authorized && result.error).toContain('Invalid calldata');
        });
    });

    describe('with short callData (less than 4 bytes)', () => {
        it('rejects short callData as invalid format', async ({ reqContext, authorizer, rpc }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const userOp = createUserOp({ callData: '0xab' });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
            expect(!result.authorized && result.error).toContain('Invalid calldata');
        });
    });

    describe('with ERC-7579 single execute callData', () => {
        const targetContract = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
        const innerCallData = '0xabcdef12' as Hex;

        it('returns authorized when authorizer allows access', async ({ reqContext, authorizer, rpc }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const callData = encodeExecute(targetContract, 0n, innerCallData);
            const userOp = createUserOp({ callData });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(true);
        });

        it('returns not authorized when authorizer denies access', async ({ reqContext, authorizer }) => {
            authorizer.setAllowRead(false);
            authorizer.setUserAddresses([defaultSender]);
            const callData = encodeExecute(targetContract, 0n, innerCallData);
            const userOp = createUserOp({ callData });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
        });

        describe('plain ETH transfer (empty inner calldata)', () => {
            const recipient = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;

            it('allows ETH transfer to any address without a permission entry', async ({
                reqContext,
                authorizer,
                rpc
            }) => {
                authorizer.setAllowRead(false); // no permission configured for recipient
                authorizer.setUserAddresses([defaultSender]);
                rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
                const callData = encodeExecute(recipient, 100000000000000000n, '0x' as Hex);
                const userOp = createUserOp({ callData });

                const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

                expect(result.authorized).toBe(true);
            });

            it('still requires permission for calls with non-empty calldata', async ({
                reqContext,
                authorizer,
                rpc
            }) => {
                authorizer.setAllowRead(false);
                authorizer.setUserAddresses([defaultSender]);
                rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
                const callData = encodeExecute(recipient, 100000000000000000n, '0xabcdef12' as Hex);
                const userOp = createUserOp({ callData });

                const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

                expect(result.authorized).toBe(false);
            });
        });
    });

    describe('with ERC-7579 batch execute callData', () => {
        const target1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
        const target2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
        const innerData1 = '0x11111111' as Hex;
        const innerData2 = '0x22222222' as Hex;

        it('returns authorized when authorizer allows access to all targets', async ({
            reqContext,
            authorizer,
            rpc
        }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const callData = encodeExecuteBatch([
                { target: target1, value: 0n, data: innerData1 },
                { target: target2, value: 0n, data: innerData2 }
            ]);
            const userOp = createUserOp({ callData });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(true);
        });

        it('returns not authorized when authorizer denies access to any target', async ({ reqContext, authorizer }) => {
            authorizer.setAllowRead(false);
            authorizer.setUserAddresses([defaultSender]);
            const callData = encodeExecuteBatch([
                { target: target1, value: 0n, data: innerData1 },
                { target: target2, value: 0n, data: innerData2 }
            ]);
            const userOp = createUserOp({ callData });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
        });

        it('handles empty batch', async ({ reqContext, authorizer, rpc }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const callData = encodeExecuteBatch([]);
            const userOp = createUserOp({ callData });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(true);
        });
    });

    describe('with unknown selector', () => {
        it('rejects unknown selector as invalid format', async ({ reqContext, authorizer, rpc }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            // Some unknown function selector
            const callData = '0xdeadbeef11223344' as Hex;
            const userOp = createUserOp({ callData });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
            expect(!result.authorized && result.error).toContain('Invalid calldata');
            expect(!result.authorized && result.error).toContain('Unsupported selector');
        });
    });

    describe('with delegatecall (not supported)', () => {
        it('rejects delegatecall as unsupported', async ({ reqContext, authorizer, rpc }) => {
            authorizer.setAllowRead(true);
            authorizer.setUserAddresses([defaultSender]);
            rpc.registerCodeFor(defaultSender, MOCK_BYTECODE);
            const mode = encodeMode(ERC7579_CALLTYPE.DELEGATECALL);
            const callData = encodeFunctionData({
                abi: SSO_EXECUTE_ABI,
                functionName: 'execute',
                args: [mode, '0x1234567890123456789012345678901234567890abcd']
            });
            const userOp = createUserOp({ callData });

            const result = await validateUserOpPermissions(reqContext, userOp, 'eth_sendUserOperation');

            expect(result.authorized).toBe(false);
            expect(!result.authorized && result.error).toContain('Invalid calldata');
            expect(!result.authorized && result.error).toContain('Delegatecall not supported');
        });
    });
});
