import type { Address } from 'viem';

// Covers kernel contracts and the adjacent protocol predeploy range, including interop built-ins.
export function isReservedContractAddress(address: Address): boolean {
    if (!/^0x[0-9a-f]{40}$/i.test(address)) {
        return false;
    }
    const value = BigInt(address);
    return value >= 0x8000n && value <= 0x1ffffn;
}
