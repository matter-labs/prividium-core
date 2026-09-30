/** Refused at boot: a feature's authorizer decides `/rpc` only, while these surfaces keep the core rules. */
export function findRpcAuthorizerConflict(
    features: { rpcAuthorizerFor?: unknown },
    env: { POLICY_PORT?: number | undefined; WALLETS_API_ENABLED: boolean }
): string | undefined {
    if (features.rpcAuthorizerFor === undefined) {
        return undefined;
    }
    if (env.POLICY_PORT !== undefined) {
        return 'A feature supplied the RPC authorizer while POLICY_PORT is set, but /admit and /judge still decide with the core rules, so one transaction would be decided by two engines. Unset POLICY_PORT or drop the feature.';
    }
    if (env.WALLETS_API_ENABLED) {
        return 'A feature supplied the RPC authorizer while WALLETS_API_ENABLED is true, but the wallet allowance route and /rpc/wallet/:token still authorize contract writes with the core rules, so a wallet token would bypass the feature. Unset WALLETS_API_ENABLED or drop the feature.';
    }
    return undefined;
}
