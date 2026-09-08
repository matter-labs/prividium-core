import {
    type AbiParameter,
    type Address,
    decodeAbiParameters,
    type Hex,
    hexToBigInt,
    hexToNumber,
    size,
    sliceHex,
    toFunctionSelector
} from 'viem';

// =============================================================================
// SSO Smart Account Constants
// =============================================================================

/**
 * Function selector for SSO ModularSmartAccount execute function.
 * Signature: execute(bytes32 mode, bytes calldata executionCalldata)
 *
 * @see https://github.com/matter-labs/zksync-sso-contracts/blob/main/src/ModularSmartAccount.sol
 */
export const SSO_EXECUTE_SELECTOR = toFunctionSelector('execute(bytes32,bytes)');

// =============================================================================
// ERC-7579 Mode Constants
// =============================================================================

/**
 * ERC-7579 call types - stored in the first byte of the mode (bytes32).
 * Defines how the execution calldata should be interpreted.
 *
 * @see https://eips.ethereum.org/EIPS/eip-7579
 */
export const ERC7579_CALLTYPE = {
    /** Single call: executionData = target || value || data (packed) */
    SINGLE: 0x00,
    /** Batch call: executionData = abi.encode(Call[]) */
    BATCH: 0x01,
    /** Delegate call: executionData = delegate || data (packed) */
    DELEGATECALL: 0xff
} as const;

// =============================================================================
// ABI Definitions
// =============================================================================

/**
 * ABI parameters for decoding the SSO execute function arguments.
 * Function: execute(bytes32 mode, bytes calldata executionCalldata)
 */
const SSO_EXECUTE_ABI_PARAMS: readonly AbiParameter[] = [
    { name: 'mode', type: 'bytes32' },
    { name: 'executionCalldata', type: 'bytes' }
] as const;

/**
 * ABI parameters for decoding batch execution calldata.
 * Structure matches ERC-7579 Call struct: (address target, uint256 value, bytes data)
 */
const ERC7579_BATCH_CALL_ABI_PARAMS: readonly AbiParameter[] = [
    {
        name: 'calls',
        type: 'tuple[]',
        components: [
            { name: 'target', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' }
        ]
    }
] as const;

// =============================================================================
// Types
// =============================================================================

export interface SsoCall {
    to: Address;
    value: bigint;
    data: Hex;
}

// =============================================================================
// Decoding Functions
// =============================================================================

/**
 * Decodes SSO smart account calldata and extracts target contracts.
 * Uses strict parsing - throws on any invalid or unsupported format.
 *
 * @throws Error if calldata is invalid, malformed, or uses unsupported call types
 */
export function decodeSsoCalldata(callData: Hex): SsoCall[] {
    // Must have at least selector (4 bytes)
    if (size(callData) < 4) {
        throw new Error('Calldata too short');
    }

    const selector = sliceHex(callData, 0, 4).toLowerCase();
    if (selector !== SSO_EXECUTE_SELECTOR) {
        throw new Error(`Unsupported selector: ${selector}`);
    }

    // Decode execute(bytes32 mode, bytes executionCalldata)
    const params = sliceHex(callData, 4);
    const [mode, executionData] = decodeAbiParameters(SSO_EXECUTE_ABI_PARAMS, params);

    // Extract call type from first byte of mode
    const callType = hexToNumber(sliceHex(mode as Hex, 0, 1));

    switch (callType) {
        case ERC7579_CALLTYPE.SINGLE:
            return [decodeSingleCall(executionData as Hex)];

        case ERC7579_CALLTYPE.BATCH:
            return decodeBatchCalls(executionData as Hex);

        case ERC7579_CALLTYPE.DELEGATECALL:
            throw new Error('Delegatecall not supported');

        default:
            throw new Error(`Unknown call type: 0x${callType.toString(16)}`);
    }
}

/**
 * Decodes ERC-7579 single call execution data.
 *
 * Format (packed, NOT ABI encoded):
 * - target: 20 bytes (address)
 * - value: 32 bytes (uint256)
 * - data: remaining bytes (calldata for the target)
 *
 * Minimum length: 52 bytes (20 + 32)
 */
function decodeSingleCall(executionData: Hex): SsoCall {
    const SINGLE_CALL_MIN_LENGTH = 52; // 20 (target) + 32 (value)
    const TARGET_OFFSET = 0;
    const TARGET_LENGTH = 20;
    const VALUE_OFFSET = 20;
    const VALUE_LENGTH = 32;
    const DATA_OFFSET = 52; // After target (20) + value (32)

    if (size(executionData) < SINGLE_CALL_MIN_LENGTH) {
        throw new Error('Single call execution data too short');
    }

    const target = sliceHex(executionData, TARGET_OFFSET, TARGET_OFFSET + TARGET_LENGTH);
    const valueHex = sliceHex(executionData, VALUE_OFFSET, VALUE_OFFSET + VALUE_LENGTH);
    const value = hexToBigInt(valueHex);
    const data = size(executionData) > DATA_OFFSET ? sliceHex(executionData, DATA_OFFSET) : ('0x' as Hex);

    return { to: target, value, data };
}

/**
 * Decodes ERC-7579 batch call execution data.
 *
 * Format: Standard ABI encoding of Call[] array
 * where Call = (address target, uint256 value, bytes data)
 */
function decodeBatchCalls(executionData: Hex): SsoCall[] {
    const [calls] = decodeAbiParameters(ERC7579_BATCH_CALL_ABI_PARAMS, executionData) as [
        Array<{ target: Address; value: bigint; data: Hex }>
    ];

    return calls.map((call) => ({
        to: call.target,
        value: call.value,
        data: call.data
    }));
}
