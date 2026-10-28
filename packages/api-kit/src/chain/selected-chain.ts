import type { ChainAddress, ChainDefinition } from './chain';

let selected: ChainDefinition | undefined;

/** Called once at boot, before any address is parsed or stored. Selecting the same chain again keeps the first definition. */
export function selectChain(chain: ChainDefinition): void {
    if (selected !== undefined && selected.id !== chain.id) {
        throw new Error(`This process already handles '${selected.id}' addresses; cannot switch to '${chain.id}'`);
    }
    selected ??= chain;
}

export function selectedChain(): ChainDefinition {
    if (selected === undefined) {
        throw new Error(
            'No chain selected: boot selects the chain TARGET_CHAIN_TYPE names, and a test suite selects one in its setup'
        );
    }
    return selected;
}

export function areChainAddressesEqual(a: ChainAddress, b: ChainAddress): boolean {
    return selectedChain().addresses.equals(a, b);
}

export function chainAddressListIncludes(list: readonly ChainAddress[], address: ChainAddress): boolean {
    return list.some((item) => areChainAddressesEqual(item, address));
}
