import { type Address, type Hex, keccak256, type PublicClient, pad } from 'viem';
import { vi } from 'vitest';
import type { DispatcherConfig } from '../../src/rpc/methods/dispatchers/types';

// Sample bytecode and addresses for mock dispatcher verification
export const MOCK_BYTECODE = '0x608060405234801561001057600080fd5b50' as Hex;
export const MOCK_BYTECODE_HASH = keccak256(MOCK_BYTECODE);
export const MOCK_BEACON = '0xbeac00beac00beac00beac00beac00beac0001' as Address;
export const MOCK_IMPLEMENTATION = '0x1111111111111111111111111111111111111111' as Address;

export function createMockRpcClient(): PublicClient {
    return {
        getCode: vi.fn().mockResolvedValue(MOCK_BYTECODE),
        getStorageAt: vi.fn().mockResolvedValue(pad(MOCK_BEACON, { size: 32 })),
        readContract: vi.fn().mockResolvedValue(MOCK_IMPLEMENTATION)
    } as unknown as PublicClient;
}

export function createDispatcherConfig(): DispatcherConfig {
    return {
        allowedBytecodeHashes: new Set([MOCK_BYTECODE_HASH.toLowerCase() as Hex]),
        allowedImplementations: new Set([MOCK_IMPLEMENTATION.toLowerCase() as Address])
    };
}
