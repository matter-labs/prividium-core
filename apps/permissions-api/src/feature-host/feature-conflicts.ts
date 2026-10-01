/** Refused at boot: a transaction must be decided by one engine on every surface that serves it. */
export function findAuthorizerConflict(
    features: { rpcAuthorizerFor?: unknown; sequencerAuthorizerFor?: unknown },
    env: { POLICY_PORT?: number | undefined; WALLETS_API_ENABLED: boolean }
): string | undefined {
    const rpc = features.rpcAuthorizerFor !== undefined;
    const sequencer = features.sequencerAuthorizerFor !== undefined;
    if (sequencer && !rpc) {
        return 'A feature supplied the sequencer authorizer without the RPC authorizer, so /rpc would decide with the core rules while /admit and /judge decide with the feature. Supply both or neither.';
    }
    if (rpc && !sequencer && env.POLICY_PORT !== undefined) {
        return 'A feature supplied the RPC authorizer without the sequencer authorizer while POLICY_PORT is set, so /admit and /judge would decide with the core rules and one transaction would be decided by two engines. Supply both, or unset POLICY_PORT.';
    }
    if (rpc && env.WALLETS_API_ENABLED) {
        return 'A feature supplied the RPC authorizer while WALLETS_API_ENABLED is true, but the wallet allowance route and /rpc/wallet/:token still authorize contract writes with the core rules, so a wallet token would bypass the feature. Unset WALLETS_API_ENABLED or drop the feature.';
    }
    return undefined;
}
