import type { Address, Hex, PublicClient } from 'viem';
import type { PinoLogger } from '../../../utils/logger';

/**
 * Represents a call that will be dispatched by a dynamic dispatcher.
 * Used by smart account proxies (execute batches) and multicall contracts.
 */
export interface DispatchedCall {
    to: Address;
    value: bigint;
    data: Hex;
}

/**
 * Result of verifying a dynamic dispatcher's configuration.
 */
export type VerificationResult = { valid: true; implementation?: Address } | { valid: false; error: string };

/**
 * Configuration for dispatcher verification.
 * Different dispatcher types use different fields.
 */
export interface DispatcherConfig {
    /** Whitelisted bytecode hashes for proxy matching (SSO BeaconProxy) */
    allowedBytecodeHashes?: Set<Hex>;
    /** Whitelisted implementation addresses (SSO implementations) */
    allowedImplementations?: Set<Address>;
    /** Whitelisted contract addresses (for singletons like Multicall3) */
    allowedAddresses?: Set<Address>;
    /** Optional logger for debug output */
    logger?: PinoLogger;
}

/**
 * A DynamicDispatcher represents a contract that can dispatch calls
 * to other contracts/methods based on its calldata.
 *
 * Examples:
 * - Smart Account Proxies (BeaconProxy, TransparentProxy, UUPS)
 * - Multicall contracts (Multicall3)
 * - Batch execution wrappers
 */
export interface DynamicDispatcher {
    /** Unique identifier for this dispatcher type */
    readonly type: string;

    /**
     * Check if a contract matches this dispatcher type.
     * May use bytecode hash, address whitelist, or other strategies.
     *
     * @param address - The contract address to check
     * @param bytecodeHash - keccak256 hash of the contract's bytecode
     * @param config - Dispatcher configuration with whitelists
     * @returns true if this dispatcher can handle the contract
     */
    matches(address: Address, bytecodeHash: Hex, config: DispatcherConfig): boolean;

    /**
     * Verify the dispatcher's configuration is trusted.
     * For proxies: check implementation is whitelisted.
     * For singletons: may be no-op if address itself is whitelisted.
     *
     * @param address - The contract address to verify
     * @param client - RPC client for reading storage/calling contracts
     * @param config - Dispatcher configuration with whitelists
     * @returns Verification result with implementation address if valid
     */
    verify(address: Address, client: PublicClient, config: DispatcherConfig): Promise<VerificationResult>;

    /**
     * Parse calldata to extract the calls that will be dispatched.
     * Returns the list of (to, value, data) tuples.
     *
     * @param callData - The calldata to parse
     * @returns Array of calls that will be dispatched
     * @throws Error if calldata is invalid or unsupported
     */
    parseCalldata(callData: Hex): DispatchedCall[];
}
