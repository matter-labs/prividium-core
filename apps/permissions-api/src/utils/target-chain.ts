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
