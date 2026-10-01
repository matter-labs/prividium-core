import { describe, expect, it } from 'vitest';
import { findAuthorizerConflict } from './feature-conflicts';

describe('findAuthorizerConflict', () => {
    const rpcAuthorizerFor = () => () => {
        throw new Error('not called');
    };
    const sequencerAuthorizerFor = () => {
        throw new Error('not called');
    };
    const env = { POLICY_PORT: undefined, WALLETS_API_ENABLED: false };
    const policyListener = { ...env, POLICY_PORT: 8010 };

    it('refuses an RPC authorizer without a sequencer authorizer while the policy listener is on', () => {
        expect(findAuthorizerConflict({ rpcAuthorizerFor }, policyListener)).toContain('POLICY_PORT');
    });

    it('refuses a sequencer authorizer without an RPC authorizer, with or without the policy listener', () => {
        expect(findAuthorizerConflict({ sequencerAuthorizerFor }, policyListener)).toContain('Supply both or neither');
        expect(findAuthorizerConflict({ sequencerAuthorizerFor }, env)).toContain('Supply both or neither');
    });

    it('refuses an RPC authorizer while the wallets API is on', () => {
        expect(findAuthorizerConflict({ rpcAuthorizerFor }, { ...env, WALLETS_API_ENABLED: true })).toContain(
            'WALLETS_API_ENABLED'
        );
        expect(
            findAuthorizerConflict(
                { rpcAuthorizerFor, sequencerAuthorizerFor },
                { ...policyListener, WALLETS_API_ENABLED: true }
            )
        ).toContain('WALLETS_API_ENABLED');
    });

    it('accepts both authorizers with the policy listener, an RPC authorizer without it, and neither', () => {
        expect(findAuthorizerConflict({ rpcAuthorizerFor, sequencerAuthorizerFor }, policyListener)).toBeUndefined();
        expect(findAuthorizerConflict({ rpcAuthorizerFor, sequencerAuthorizerFor }, env)).toBeUndefined();
        expect(findAuthorizerConflict({ rpcAuthorizerFor }, env)).toBeUndefined();
        expect(findAuthorizerConflict({}, { POLICY_PORT: 8010, WALLETS_API_ENABLED: true })).toBeUndefined();
    });
});
