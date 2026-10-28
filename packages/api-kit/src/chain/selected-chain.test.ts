import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import type { AddressCodec, ChainDefinition } from './chain';

const hex4: AddressCodec = {
    schema: z.string().regex(/^0x[0-9a-f]{8}$/),
    pattern: /^0x[0-9a-f]{8}$/,
    equals: (a, b) => a === b,
    toBytes: (address) => Buffer.from(address.slice(2), 'hex'),
    fromBytes: (bytes) => `0x${Buffer.from(bytes).toString('hex')}`
};

const chain = (id: string): ChainDefinition => ({
    id,
    addresses: hex4,
    capabilities: { walletSignIn: false, faucet: false, sequencerCallbacks: false, disclosureMethods: false },
    systemContracts: []
});

// Fresh module state per test: the selection is process-wide by design.
async function loadSelectedChain() {
    return import('./selected-chain');
}

describe('selected chain', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('refuses to answer before a chain is selected', async () => {
        const { selectedChain } = await loadSelectedChain();
        expect(() => selectedChain()).toThrow('No chain selected');
    });

    it('returns the chain selected at boot', async () => {
        const { selectChain, selectedChain } = await loadSelectedChain();
        const one = chain('one');
        selectChain(one);
        expect(selectedChain()).toBe(one);
    });

    it('keeps the first definition when the same chain is selected again', async () => {
        const { selectChain, selectedChain } = await loadSelectedChain();
        const first = chain('one');
        selectChain(first);
        selectChain(chain('one'));
        expect(selectedChain()).toBe(first);
    });

    it('refuses another chain once one is selected', async () => {
        const { selectChain } = await loadSelectedChain();
        selectChain(chain('one'));
        expect(() => selectChain(chain('two'))).toThrow("already handles 'one' addresses");
    });

    it('compares addresses with the selected codec', async () => {
        const { selectChain, areChainAddressesEqual, chainAddressListIncludes } = await loadSelectedChain();
        selectChain(chain('one'));
        expect(areChainAddressesEqual('0x00000001', '0x00000001')).toBe(true);
        expect(chainAddressListIncludes(['0x00000002'], '0x00000001')).toBe(false);
    });
});
