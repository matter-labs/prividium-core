export const TARGET_CHAIN_TYPES = ['zksync-os', 'besu'] as const;

export type TargetChainType = (typeof TARGET_CHAIN_TYPES)[number];

/**
 * True when the chain submits via sync `eth_sendRawTransactionSync`, so a
 * successful submission means the tx is mined rather than merely in-mempool.
 */
export const SUBMISSION_CONFIRMS_INCLUSION: Record<TargetChainType, boolean> = {
    'zksync-os': true,
    besu: false
};

/**
 * True when the chain has zksync system contracts at reserved addresses for boot to sync.
 */
export const HAS_ZKSYNC_SYSTEM_CONTRACTS: Record<TargetChainType, boolean> = {
    'zksync-os': true,
    besu: false
};

/** True when the chain settles to an L1 that the well-known endpoint reports. */
export const SETTLES_TO_L1: Record<TargetChainType, boolean> = {
    'zksync-os': true,
    besu: false
};
