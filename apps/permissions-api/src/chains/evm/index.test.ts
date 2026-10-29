import { describe, expect, it } from 'vitest';
import { TestExternalRpc } from '#test/rpc/test-external-rpc';
import type { TargetChainType } from '#utils/target-chain';
import { evmChain, evmChainDefinition, evmChainModule } from './index';
import { ZKSYNC_SYSTEM_CONTRACTS } from './system-contracts';

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc';

describe('EVM chain module', () => {
    it('gives system contracts, sequencer callbacks and disclosure methods to zksync-os only', () => {
        expect(evmChainDefinition('zksync-os').systemContracts).toBe(ZKSYNC_SYSTEM_CONTRACTS);
        expect(evmChainDefinition('besu').systemContracts).toEqual([]);
        expect(evmChainDefinition('zksync-os').capabilities).toEqual({
            walletSignIn: true,
            faucet: true,
            sequencerCallbacks: true,
            disclosureMethods: true
        });
        expect(evmChainDefinition('besu').capabilities).toMatchObject({
            sequencerCallbacks: false,
            disclosureMethods: false
        });
    });

    const connect = (chainType: TargetChainType) =>
        evmChainModule.connect({ nodeUrl: 'http://node', chainType, env: {} });

    it('fronts the variant the chain type names', async () => {
        expect((await connect('besu')).systemContracts).toEqual([]);
        expect((await connect('zksync-os')).systemContracts).toBe(ZKSYNC_SYSTEM_CONTRACTS);
    });

    it('asks the node whether a contract exists', async () => {
        const rpc = new TestExternalRpc();
        rpc.registerCodeFor(CONTRACT, '0x60806040');

        expect(await evmChain(rpc).contractExists(CONTRACT)).toBe(true);
        expect(await evmChain(rpc).contractExists(WALLET)).toBe(false);
    });

    it('treats an account with no transactions and no code as unused', async () => {
        const rpc = new TestExternalRpc();
        const chain = evmChain(rpc);

        expect(await chain.accountIsUnused(WALLET)).toBe(true);

        rpc.setNonceFor(WALLET, 1n);
        expect(await chain.accountIsUnused(WALLET)).toBe(false);

        rpc.registerCodeFor(CONTRACT, '0x60806040');
        expect(await chain.accountIsUnused(CONTRACT)).toBe(false);
    });
});
