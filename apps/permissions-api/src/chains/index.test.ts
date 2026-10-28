import { type Chain, type ChainModule, type ChainModuleRef, selectedChain } from '@repo/api-kit';
import { describe, expect, it, vi } from 'vitest';
import { evmChainDefinition } from './evm';
import { chainModules, chainRegistry } from './index';
import type { ChainSettings } from './supported-settings';

const unusedModule = (id: string, chainTypes: readonly string[] = [id]): ChainModuleRef => ({
    id,
    chainTypes,
    load: () => Promise.reject(new Error('unused'))
});

const bareChain: Chain = {
    id: 'bare',
    addresses: evmChainDefinition().addresses,
    capabilities: { walletSignIn: false, faucet: false, sequencerCallbacks: false, disclosureMethods: false },
    systemContracts: [],
    contractExists: async () => false,
    accountIsUnused: async () => true
};
const bareModule: ChainModule = { id: 'bare', chainTypes: ['bare'], connect: async () => bareChain };
const bareRef: ChainModuleRef = { id: 'bare', chainTypes: ['bare'], load: async () => bareModule };

const noneSet: ChainSettings = {
    AUTH_METHODS: ['oidc'],
    CRYPTO_NATIVE_ADMIN_WALLETS: [],
    CRYPTO_NATIVE_LOGIN_ALLOWLIST: [],
    WATCHDOG_WALLETS: [],
    KNOWN_DEV_WALLETS_ALLOWLIST: [],
    FAUCET_ENABLED: false,
    MULTI_ORG_ENABLED: false,
    DISCLOSURE_METHODS_ENABLED: false
};

const connect = async (raw: string, registered: readonly ChainModuleRef[] = [], settings = noneSet) => {
    const chains = chainRegistry(registered);
    return chains.connect(chains.parse(raw), { nodeUrl: 'http://node', env: {}, settings });
};

describe('chain registry', () => {
    it('serves the EVM chain types and those of the modules the entrypoint registers', () => {
        expect([...chainModules([unusedModule('other')]).keys()]).toEqual(['zksync-os', 'besu', 'other']);
    });

    it('refuses two modules with one id', () => {
        expect(() => chainModules([unusedModule('evm', ['evm-2'])])).toThrow(
            "Two chain modules are registered as 'evm'"
        );
    });

    it('refuses two modules serving one chain type', () => {
        expect(() => chainModules([unusedModule('other', ['besu'])])).toThrow(
            "Chain modules 'evm' and 'other' both serve TARGET_CHAIN_TYPE='besu'"
        );
    });

    it('parses only a chain type this build serves', () => {
        expect(chainRegistry().parse('besu')).toBe('besu');
        expect(() => chainRegistry().parse('solana')).toThrow(
            "TARGET_CHAIN_TYPE='solana' is not a chain type this build serves; it serves: zksync-os, besu"
        );
    });

    it('connects the module the chain type names', async () => {
        const zksync = await connect('zksync-os');
        const besu = await connect('besu');

        expect(zksync.id).toBe('evm');
        expect(zksync.systemContracts).toEqual(evmChainDefinition('zksync-os').systemContracts);
        expect(besu.systemContracts).toEqual([]);
    });

    it('loads only the module the chain type names', async () => {
        const other = { id: 'other', chainTypes: ['other'], load: vi.fn(() => Promise.reject(new Error('unused'))) };

        await connect('zksync-os', [other]);

        expect(other.load).not.toHaveBeenCalled();
    });

    it('fails the boot on a module that loads under another id', async () => {
        const mislabelled: ChainModuleRef = { ...bareRef, load: async () => ({ ...bareModule, id: 'something-else' }) };

        await expect(connect('bare', [mislabelled])).rejects.toThrow(
            "The chain module registered as 'bare' loaded as 'something-else'"
        );
    });

    it('fails the boot on a module that does not serve the chain type it is registered for', async () => {
        const narrower: ChainModuleRef = {
            ...bareRef,
            load: async () => ({ ...bareModule, chainTypes: ['something-else'] })
        };

        await expect(connect('bare', [narrower])).rejects.toThrow(
            "The 'bare' chain module does not serve TARGET_CHAIN_TYPE='bare'; it serves: something-else"
        );
    });

    it('refuses a setting the chain cannot honour, before the chain is selected', async () => {
        await expect(connect('bare', [bareRef], { ...noneSet, FAUCET_ENABLED: true })).rejects.toThrow(
            "TARGET_CHAIN_TYPE='bare' does not support FAUCET_ENABLED: unset it"
        );

        expect(selectedChain().id).toBe('evm');
    });
});
