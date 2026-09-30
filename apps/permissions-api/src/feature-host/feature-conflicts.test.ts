import { describe, expect, it } from 'vitest';
import { findRpcAuthorizerConflict } from './feature-conflicts';

describe('findRpcAuthorizerConflict', () => {
    const rpcAuthorizerFor = () => () => {
        throw new Error('not called');
    };
    const env = { POLICY_PORT: undefined, WALLETS_API_ENABLED: false };

    it('refuses a supplied RPC authorizer while the policy listener is on', () => {
        expect(findRpcAuthorizerConflict({ rpcAuthorizerFor }, { ...env, POLICY_PORT: 8010 })).toContain('POLICY_PORT');
    });

    it('refuses a supplied RPC authorizer while the wallets API is on', () => {
        expect(findRpcAuthorizerConflict({ rpcAuthorizerFor }, { ...env, WALLETS_API_ENABLED: true })).toContain(
            'WALLETS_API_ENABLED'
        );
    });

    it('accepts a supplied RPC authorizer with neither surface on, and either surface without one', () => {
        expect(findRpcAuthorizerConflict({ rpcAuthorizerFor }, env)).toBeUndefined();
        expect(findRpcAuthorizerConflict({}, { POLICY_PORT: 8010, WALLETS_API_ENABLED: true })).toBeUndefined();
    });
});
