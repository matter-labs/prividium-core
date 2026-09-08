import { type Hex, hexToBigInt, keccak256, numberToHex, pad, toHex } from 'viem';

/**
 * Compute EIP-1967 storage slot from human-readable key.
 * Formula: keccak256(key) - 1
 *
 * This is the standard way EIP-1967 slots are derived.
 * @see https://eips.ethereum.org/EIPS/eip-1967
 *
 * @param key - The human-readable key (e.g., 'eip1967.proxy.beacon')
 * @returns The 32-byte storage slot as hex
 */
export function eip1967Slot(key: string): Hex {
    const hash = keccak256(toHex(key));
    return numberToHex(hexToBigInt(hash) - 1n, { size: 32 });
}

// =============================================================================
// Pre-computed EIP-1967 Storage Slots
// These are derived at module load time from human-readable keys
// =============================================================================

/**
 * Beacon slot: keccak256("eip1967.proxy.beacon") - 1
 * Used by BeaconProxy contracts to store the beacon address.
 */
export const EIP1967_BEACON_SLOT = eip1967Slot('eip1967.proxy.beacon');

/**
 * Implementation slot: keccak256("eip1967.proxy.implementation") - 1
 * Used by TransparentUpgradeableProxy and UUPS proxies to store the implementation address.
 */
export const EIP1967_IMPLEMENTATION_SLOT = eip1967Slot('eip1967.proxy.implementation');

/**
 * Admin slot: keccak256("eip1967.proxy.admin") - 1
 * Used by TransparentUpgradeableProxy to store the admin address.
 */
export const EIP1967_ADMIN_SLOT = eip1967Slot('eip1967.proxy.admin');

/**
 * Zero slot value for comparison.
 * A 32-byte slot filled with zeros indicates an unset/empty value.
 */
export const ZERO_SLOT = pad('0x0', { size: 32 });
