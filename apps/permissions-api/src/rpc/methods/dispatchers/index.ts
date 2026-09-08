import { type Address, type Hex, keccak256 } from 'viem';
import type { ExternalRpc } from '../../target-rpc';
import { ssoBeaconProxyDispatcher } from './sso-beacon-proxy';
import type { DispatchedCall, DispatcherConfig, DynamicDispatcher, VerificationResult } from './types';

// =============================================================================
// Dispatcher Registry
// =============================================================================

/**
 * Registry of all known dynamic dispatchers.
 * New dispatcher types should be added here.
 */
const dispatchers: DynamicDispatcher[] = [
    ssoBeaconProxyDispatcher
    // Future: multicall3Dispatcher,
    // Future: transparentProxyDispatcher,
];

// =============================================================================
// Types
// =============================================================================

export interface DispatcherMatchResult {
    dispatcher: DynamicDispatcher;
    bytecodeHash: Hex;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Find a matching dispatcher for the given address.
 *
 * @param address - The contract address to check
 * @param externalRpc - RPC client for reading bytecode
 * @param config - Dispatcher configuration with whitelists
 * @returns The matching dispatcher and bytecode hash, or null if none match
 */
export async function findDispatcher(
    address: Address,
    externalRpc: ExternalRpc,
    config: DispatcherConfig,
    rpcReqId: string | number
): Promise<DispatcherMatchResult | null> {
    // Get bytecode and compute hash
    const code = await externalRpc.getCodeFor(`${rpcReqId}_getCode_${address}`, address);
    if (!code || code === '0x') return null;
    const bytecodeHash = keccak256(code);

    // Find matching dispatcher
    for (const dispatcher of dispatchers) {
        if (dispatcher.matches(address, bytecodeHash, config)) {
            return { dispatcher, bytecodeHash };
        }
    }

    return null;
}

/**
 * Verify and parse a dynamic dispatcher.
 * Returns the verification result and parsed calls if valid.
 *
 * @param address - The contract address to verify
 * @param callData - The calldata to parse
 * @param client - RPC client for verification
 * @param config - Dispatcher configuration with whitelists
 * @returns Object with verification result, parsed calls, and dispatcher type
 */
export async function verifyAndParseDispatcher(
    address: Address,
    callData: Hex,
    client: ExternalRpc,
    config: DispatcherConfig
): Promise<{
    result: VerificationResult;
    calls?: DispatchedCall[];
    dispatcherType?: string;
}> {
    const match = await findDispatcher(address, client, config, '');
    if (!match) {
        return { result: { valid: false, error: 'Unknown dispatcher type' } };
    }

    const result = await match.dispatcher.verify(address, client.viemPublicClient(), config);
    if (!result.valid) {
        return { result, dispatcherType: match.dispatcher.type };
    }

    try {
        const calls = match.dispatcher.parseCalldata(callData);
        return { result, calls, dispatcherType: match.dispatcher.type };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            result: { valid: false, error: `Invalid calldata: ${errorMessage}` },
            dispatcherType: match.dispatcher.type
        };
    }
}

// =============================================================================
// Re-exports
// =============================================================================

export { EIP1967_BEACON_SLOT, EIP1967_IMPLEMENTATION_SLOT, eip1967Slot } from './eip1967';
export { ssoBeaconProxyDispatcher } from './sso-beacon-proxy';
export type { DispatchedCall, DispatcherConfig, DynamicDispatcher, VerificationResult } from './types';
