import type { Address } from 'viem';

export class AddressSet {
    private addresses: Set<string>;
    private someAddress: `0x${string}` | null;

    constructor(addresses: Address[]) {
        this.addresses = new Set(addresses.map((addr) => addr.toLowerCase()));
        this.someAddress = addresses[0] || null;
    }

    has(addr: Address): boolean {
        return this.addresses.has(addr.toLowerCase());
    }

    first(): Address | null {
        return this.someAddress;
    }

    all(): Address[] {
        return [...this.addresses] as Address[];
    }
}
