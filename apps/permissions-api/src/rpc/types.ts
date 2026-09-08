import type { Hex } from 'viem';

export type TxData = {
    from: Hex;
    data: Hex;
    to: Hex | undefined;
    nonce: number;
    value: bigint;
};
