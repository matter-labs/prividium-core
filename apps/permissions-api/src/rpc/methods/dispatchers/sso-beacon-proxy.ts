import { type Address, getAddress, type Hex, type PublicClient } from 'viem';
import { decodeSsoCalldata } from '../handlers/bundler/utils/sso-calldata';
import { EIP1967_BEACON_SLOT, ZERO_SLOT } from './eip1967';
import type { DispatchedCall, DispatcherConfig, DynamicDispatcher, VerificationResult } from './types';

/**
 * SSO BeaconProxy Dispatcher
 *
 * Handles ZKsync SSO smart accounts deployed as BeaconProxy contracts.
 * These accounts use the ERC-7579 execute(bytes32,bytes) interface for
 * single and batch call execution.
 *
 * Verification:
 * 1. Match by bytecode hash (configured externally)
 * 2. Read beacon address from EIP-1967 beacon slot
 * 3. Call beacon.implementation() to get implementation address
 * 4. Verify implementation is whitelisted
 *
 * @see https://github.com/matter-labs/zksync-sso
 */
export const ssoBeaconProxyDispatcher: DynamicDispatcher = {
    type: 'sso-beacon-proxy',

    matches(_address: Address, bytecodeHash: Hex, config: DispatcherConfig): boolean {
        // Match by bytecode hash (configured externally via env vars)
        if (!config.allowedBytecodeHashes?.size) return false;
        return config.allowedBytecodeHashes.has(bytecodeHash.toLowerCase() as Hex);
    },

    async verify(address: Address, client: PublicClient, config: DispatcherConfig): Promise<VerificationResult> {
        // 1. Read beacon address from EIP-1967 beacon slot
        const beaconSlotValue = await client.getStorageAt({
            address,
            slot: EIP1967_BEACON_SLOT
        });

        if (!beaconSlotValue || beaconSlotValue === ZERO_SLOT) {
            return { valid: false, error: 'No beacon address found in EIP-1967 slot' };
        }

        // Extract address from 32-byte slot value (last 20 bytes)
        const beaconAddress = getAddress(`0x${beaconSlotValue.slice(-40)}`);

        // 2. Call beacon.implementation() to get the implementation address
        let implementation: Address;
        try {
            implementation = await client.readContract({
                address: beaconAddress,
                abi: [
                    {
                        name: 'implementation',
                        type: 'function',
                        inputs: [],
                        outputs: [{ name: '', type: 'address' }],
                        stateMutability: 'view'
                    }
                ] as const,
                functionName: 'implementation'
            });
        } catch (err) {
            config.logger?.debug(
                { address, beaconAddress, err: err instanceof Error ? err.message : String(err) },
                '[ssoBeaconProxyDispatcher.verify] Failed to read implementation from beacon'
            );
            return { valid: false, error: 'Failed to read implementation from beacon' };
        }

        // 3. Verify implementation is in whitelist (configured externally via env vars)
        const normalizedImpl = implementation.toLowerCase() as Address;
        if (!config.allowedImplementations?.has(normalizedImpl)) {
            return { valid: false, error: 'Untrusted smart account implementation' };
        }

        return { valid: true, implementation };
    },

    parseCalldata(callData: Hex): DispatchedCall[] {
        // Reuse existing SSO calldata parser (handles ERC-7579 execute format)
        const calls = decodeSsoCalldata(callData);
        return calls.map((c) => ({ to: c.to, value: c.value, data: c.data }));
    }
};
