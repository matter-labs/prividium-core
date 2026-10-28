import { describe, expect, it } from 'vitest';
import { findUnsupportedSettings } from './supported-settings';

const noneSet = {
    AUTH_METHODS: ['oidc'],
    CRYPTO_NATIVE_ADMIN_WALLETS: [],
    CRYPTO_NATIVE_LOGIN_ALLOWLIST: [],
    WATCHDOG_WALLETS: [],
    KNOWN_DEV_WALLETS_ALLOWLIST: [],
    FAUCET_ENABLED: false,
    MULTI_ORG_ENABLED: false,
    DISCLOSURE_METHODS_ENABLED: false
};

const everything = {
    AUTH_METHODS: ['oidc', 'crypto_native'],
    CRYPTO_NATIVE_ADMIN_WALLETS: ['0x1'],
    CRYPTO_NATIVE_LOGIN_ALLOWLIST: ['0x2'],
    WATCHDOG_WALLETS: ['0x3'],
    KNOWN_DEV_WALLETS_ALLOWLIST: ['0x4'],
    FAUCET_ENABLED: true,
    POLICY_PORT: 8010,
    MULTI_ORG_ENABLED: true,
    DISCLOSURE_METHODS_ENABLED: true
};

const FULL = { walletSignIn: true, faucet: true, sequencerCallbacks: true, disclosureMethods: true };
const BARE = { walletSignIn: false, faucet: false, sequencerCallbacks: false, disclosureMethods: false };

describe('findUnsupportedSettings', () => {
    it('accepts every setting on a chain that supports them all', () => {
        expect(findUnsupportedSettings('zksync-os', FULL, everything)).toBeUndefined();
    });

    it('accepts a bare chain when none of those settings is set', () => {
        expect(findUnsupportedSettings('bare', BARE, noneSet)).toBeUndefined();
    });

    it.each([
        [
            'walletSignIn',
            "AUTH_METHODS 'crypto_native', CRYPTO_NATIVE_ADMIN_WALLETS, CRYPTO_NATIVE_LOGIN_ALLOWLIST, WATCHDOG_WALLETS, KNOWN_DEV_WALLETS_ALLOWLIST: unset them"
        ],
        ['faucet', 'FAUCET_ENABLED: unset it'],
        ['sequencerCallbacks', 'POLICY_PORT, MULTI_ORG_ENABLED: unset them'],
        ['disclosureMethods', 'DISCLOSURE_METHODS_ENABLED: unset it']
    ] as const)('refuses only the settings that need %s', (capability, refused) => {
        expect(findUnsupportedSettings('chain', { ...FULL, [capability]: false }, everything)).toBe(
            `TARGET_CHAIN_TYPE='chain' does not support ${refused}`
        );
    });

    it('names each setting the chain cannot honour', () => {
        const env = {
            ...noneSet,
            AUTH_METHODS: ['oidc', 'crypto_native'],
            WATCHDOG_WALLETS: ['0x1'],
            KNOWN_DEV_WALLETS_ALLOWLIST: ['0x2'],
            FAUCET_ENABLED: true
        };

        expect(findUnsupportedSettings('bare', BARE, env)).toBe(
            "TARGET_CHAIN_TYPE='bare' does not support AUTH_METHODS 'crypto_native', WATCHDOG_WALLETS, KNOWN_DEV_WALLETS_ALLOWLIST, FAUCET_ENABLED: unset them"
        );
        expect(findUnsupportedSettings('bare', BARE, { ...noneSet, FAUCET_ENABLED: true })).toBe(
            "TARGET_CHAIN_TYPE='bare' does not support FAUCET_ENABLED: unset it"
        );
    });

    it('refuses the settings that need sequencer callbacks or disclosure methods', () => {
        const env = { ...noneSet, POLICY_PORT: 8010, MULTI_ORG_ENABLED: true, DISCLOSURE_METHODS_ENABLED: true };

        expect(findUnsupportedSettings('bare', BARE, env)).toBe(
            "TARGET_CHAIN_TYPE='bare' does not support POLICY_PORT, MULTI_ORG_ENABLED, DISCLOSURE_METHODS_ENABLED: unset them"
        );
    });
});
