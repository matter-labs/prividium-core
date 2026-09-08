import {
    type Account,
    type Address,
    type BlockTag,
    type Chain,
    type Client,
    type Hex,
    numberToHex,
    type RpcSchema,
    type Transport
} from 'viem';
import type { AccountDataDisclosureResult, EthCallDisclosureResult } from './disclosure-result.js';

export type DisclosureBlockNumber = number | bigint | Hex | BlockTag;

export type SelectiveDisclosureActions = {
    tokenSupplyDisclosure: (
        tokenAddress: Address,
        blockNumber: DisclosureBlockNumber
    ) => Promise<EthCallDisclosureResult>;
    tokenBalanceDisclosure: (
        tokenAddress: Address,
        holderAddress: Address,
        blockNumber: DisclosureBlockNumber
    ) => Promise<EthCallDisclosureResult>;
    accountDataDisclosure: (
        address: Address,
        blockNumber: DisclosureBlockNumber
    ) => Promise<AccountDataDisclosureResult>;
};

export type TokenSupplyDisclosureRpc = {
    Method: 'prividium_tokenSupplyDisclosure';
    Parameters: [tokenAddress: Address, blockNumber: Hex | BlockTag];
    ReturnType: EthCallDisclosureResult;
};

export type TokenBalanceDisclosureRpc = {
    Method: 'prividium_tokenBalanceDisclosure';
    Parameters: [tokenAddress: Address, holderAddress: Address, blockNumber: Hex | BlockTag];
    ReturnType: EthCallDisclosureResult;
};

export type AccountDataDisclosureRpc = {
    Method: 'prividium_accountDataDisclosure';
    Parameters: [address: Address, blockNumber: Hex | BlockTag];
    ReturnType: AccountDataDisclosureResult;
};

function encodeBlockNumber(block: DisclosureBlockNumber): Hex | BlockTag {
    return typeof block === 'string' ? block : numberToHex(block);
}

/**
 * Viem action extender that adds Prividium selective-disclosure RPC methods
 * to a client. Use with `client.extend(selectiveDisclosureActions)`.
 */
export function selectiveDisclosureActions<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined,
    accountOrAddress extends Account | undefined = undefined,
    rpcSchema extends RpcSchema | undefined = undefined
>(client: Client<transport, chain, accountOrAddress, rpcSchema>): SelectiveDisclosureActions {
    return {
        async tokenSupplyDisclosure(tokenAddress, blockNumber) {
            return client.request<TokenSupplyDisclosureRpc>({
                method: 'prividium_tokenSupplyDisclosure',
                params: [tokenAddress, encodeBlockNumber(blockNumber)]
            });
        },
        async tokenBalanceDisclosure(tokenAddress, holderAddress, blockNumber) {
            return client.request<TokenBalanceDisclosureRpc>({
                method: 'prividium_tokenBalanceDisclosure',
                params: [tokenAddress, holderAddress, encodeBlockNumber(blockNumber)]
            });
        },
        async accountDataDisclosure(address, blockNumber) {
            return client.request<AccountDataDisclosureRpc>({
                method: 'prividium_accountDataDisclosure',
                params: [address, encodeBlockNumber(blockNumber)]
            });
        }
    };
}
