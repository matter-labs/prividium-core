import { type ChainAddress, selectedChain } from '@repo/api-kit';

export function isSystemContractAddress(address: ChainAddress): boolean {
    const { systemContracts, addresses } = selectedChain();
    return systemContracts.some((contract) => addresses.equals(contract.address, address));
}
