import { getAddress, type Hex } from 'viem';

export function createTransaction(
    txHash: Hex,
    options: {
        from?: Hex;
        to?: Hex;
        blockNumber?: Hex;
        blockHash?: Hex;
    } = {}
): TransactionDetails {
    return {
        hash: txHash,
        from: getAddress(options.from || '0x0000000000000000000000000000000000000001'),
        to: getAddress(options.to || '0x0000000000000000000000000000000000000002'),
        blockNumber: options.blockNumber || '0x1d1551',
        blockHash: options.blockHash || '0xbf7e331f7f7c1dd2e05159666b3bf8bc7a8a3a9eb1d518969eab529dd9b88c1a',
        nonce: '0x0',
        transactionIndex: '0x0',
        value: '0x0',
        gasPrice: '0x0',
        gas: '0x0',
        input: '0x',
        v: '0x1b',
        r: '0x0',
        s: '0x0',
        chainId: '0x777',
        type: '0x01'
    };
}

export type TransactionDetails = {
    type: Hex;
    chainId: Hex;
    nonce: Hex;
    gasPrice: Hex;
    gas: Hex;
    to: Hex;
    value: Hex;
    input: Hex;
    r: Hex;
    s: Hex;
    v: Hex;
    hash: Hex;
    blockHash: Hex;
    blockNumber: Hex;
    transactionIndex: Hex;
    from: Hex;
};
