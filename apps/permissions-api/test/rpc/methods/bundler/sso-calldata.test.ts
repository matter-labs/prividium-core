import { type Address, concat, encodeAbiParameters, encodeFunctionData, type Hex, pad, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
    decodeSsoCalldata,
    ERC7579_CALLTYPE,
    SSO_EXECUTE_SELECTOR
} from '../../../../src/rpc/methods/handlers/bundler/utils/sso-calldata';

// =============================================================================
// Test ABI Definitions (mirrors production constants)
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
function encodeSingleExecute(target: Address, value: bigint, data: Hex): Hex {
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
function encodeBatchExecute(calls: Array<{ target: Address; value: bigint; data: Hex }>): Hex {
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

describe('decodeSsoCalldata', () => {
    describe('selector validation', () => {
        it('exports the correct SSO execute selector', () => {
            expect(SSO_EXECUTE_SELECTOR).toBe('0xe9ae5c53');
        });
    });

    describe('valid single calls', () => {
        it('decodes single call with data', () => {
            const target = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
            const callData = encodeSingleExecute(target, 0n, '0xabcdef12');

            const calls = decodeSsoCalldata(callData);

            expect(calls).toHaveLength(1);
            expect(calls[0]!.to.toLowerCase()).toBe(target.toLowerCase());
            expect(calls[0]!.data).toBe('0xabcdef12');
        });

        it('decodes single call with empty data', () => {
            const target = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
            const callData = encodeSingleExecute(target, 1000n, '0x');

            const calls = decodeSsoCalldata(callData);

            expect(calls).toHaveLength(1);
            expect(calls[0]!.to.toLowerCase()).toBe(target.toLowerCase());
            expect(calls[0]!.data).toBe('0x');
        });

        it('decodes single call with value', () => {
            const target = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
            const callData = encodeSingleExecute(target, 1000000000000000000n, '0x12345678');

            const calls = decodeSsoCalldata(callData);

            expect(calls).toHaveLength(1);
            expect(calls[0]!.to.toLowerCase()).toBe(target.toLowerCase());
            expect(calls[0]!.data).toBe('0x12345678');
        });
    });

    describe('valid batch calls', () => {
        it('decodes batch with multiple calls', () => {
            const inputCalls = [
                {
                    target: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address,
                    value: 0n,
                    data: '0x1234' as Hex
                },
                {
                    target: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address,
                    value: 100n,
                    data: '0x5678' as Hex
                }
            ];
            const callData = encodeBatchExecute(inputCalls);

            const result = decodeSsoCalldata(callData);

            expect(result).toHaveLength(2);
            expect(result[0]!.to.toLowerCase()).toBe(inputCalls[0]!.target.toLowerCase());
            expect(result[0]!.data).toBe(inputCalls[0]!.data);
            expect(result[1]!.to.toLowerCase()).toBe(inputCalls[1]!.target.toLowerCase());
            expect(result[1]!.data).toBe(inputCalls[1]!.data);
        });

        it('decodes empty batch', () => {
            const callData = encodeBatchExecute([]);

            const result = decodeSsoCalldata(callData);

            expect(result).toHaveLength(0);
        });

        it('decodes batch with single call', () => {
            const inputCalls = [
                {
                    target: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address,
                    value: 0n,
                    data: '0xdeadbeef' as Hex
                }
            ];
            const callData = encodeBatchExecute(inputCalls);

            const result = decodeSsoCalldata(callData);

            expect(result).toHaveLength(1);
            expect(result[0]!.to.toLowerCase()).toBe(inputCalls[0]!.target.toLowerCase());
            expect(result[0]!.data).toBe(inputCalls[0]!.data);
        });
    });

    describe('strict rejection of invalid input', () => {
        it('throws on empty calldata', () => {
            expect(() => decodeSsoCalldata('0x')).toThrow('Calldata too short');
        });

        it('throws on calldata shorter than selector', () => {
            expect(() => decodeSsoCalldata('0xab')).toThrow('Calldata too short');
        });

        it('throws on calldata with only selector (3 bytes)', () => {
            expect(() => decodeSsoCalldata('0xabcdef')).toThrow('Calldata too short');
        });

        it('throws on unknown selector', () => {
            expect(() => decodeSsoCalldata('0xdeadbeef1234567890' as Hex)).toThrow('Unsupported selector');
        });

        it('throws on delegatecall', () => {
            const mode = encodeMode(ERC7579_CALLTYPE.DELEGATECALL);
            const callData = encodeFunctionData({
                abi: SSO_EXECUTE_ABI,
                functionName: 'execute',
                args: [mode, '0x1234567890123456789012345678901234567890abcd']
            });

            expect(() => decodeSsoCalldata(callData)).toThrow('Delegatecall not supported');
        });

        it('throws on unknown call type', () => {
            const mode = encodeMode(0x42); // Unknown call type
            const callData = encodeFunctionData({
                abi: SSO_EXECUTE_ABI,
                functionName: 'execute',
                args: [mode, '0x']
            });

            expect(() => decodeSsoCalldata(callData)).toThrow('Unknown call type');
        });

        it('throws on malformed single call (too short)', () => {
            const mode = encodeMode(ERC7579_CALLTYPE.SINGLE);
            const callData = encodeFunctionData({
                abi: SSO_EXECUTE_ABI,
                functionName: 'execute',
                args: [mode, '0x1234'] // Too short for single call (needs 52 bytes minimum)
            });

            expect(() => decodeSsoCalldata(callData)).toThrow('Single call execution data too short');
        });

        it('throws on single call with exactly 51 bytes (one byte short)', () => {
            const mode = encodeMode(ERC7579_CALLTYPE.SINGLE);
            // 51 bytes: 20 (address) + 31 (partial value) = not enough
            const shortData = `0x${'aa'.repeat(51)}`;
            const callData = encodeFunctionData({
                abi: SSO_EXECUTE_ABI,
                functionName: 'execute',
                args: [mode, shortData as Hex]
            });

            expect(() => decodeSsoCalldata(callData)).toThrow('Single call execution data too short');
        });
    });

    describe('ERC7579_CALLTYPE constants', () => {
        it('has correct values for call types', () => {
            expect(ERC7579_CALLTYPE.SINGLE).toBe(0x00);
            expect(ERC7579_CALLTYPE.BATCH).toBe(0x01);
            expect(ERC7579_CALLTYPE.DELEGATECALL).toBe(0xff);
        });
    });
});
