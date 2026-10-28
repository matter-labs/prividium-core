import type { Chain, ChainAddress, ChainDefinition, ChainModule } from '@repo/api-kit';
import type { Address } from 'viem';
import { type ExternalRpc, TargetRpc } from '../../rpc/target-rpc';
import {
    HAS_ZKSYNC_SYSTEM_CONTRACTS,
    SEQUENCER_CALLS_BACK,
    SERVES_DISCLOSURE_METHODS,
    TARGET_CHAIN_TYPES,
    type TargetChainType
} from '../../utils/target-chain';
import { EVM_ADDRESSES, isEvmAddress } from './addresses';
import { ZKSYNC_SYSTEM_CONTRACTS } from './system-contracts';

export const EVM_CHAIN_ID = 'evm';

export function evmChainDefinition(variant: TargetChainType = 'zksync-os'): ChainDefinition {
    return {
        id: EVM_CHAIN_ID,
        addresses: EVM_ADDRESSES,
        capabilities: {
            walletSignIn: true,
            faucet: true,
            sequencerCallbacks: SEQUENCER_CALLS_BACK[variant],
            disclosureMethods: SERVES_DISCLOSURE_METHODS[variant]
        },
        systemContracts: HAS_ZKSYNC_SYSTEM_CONTRACTS[variant] ? ZKSYNC_SYSTEM_CONTRACTS : []
    };
}

export function evmChain(rpc: Pick<ExternalRpc, 'isContract' | 'nonceFor'>, variant?: TargetChainType): Chain {
    return {
        ...evmChainDefinition(variant),
        contractExists: (address) => rpc.isContract(evmAddress(address)),
        accountIsUnused: async (address) => {
            const account = evmAddress(address);
            const [nonce, isContract] = await Promise.all([rpc.nonceFor(account), rpc.isContract(account)]);
            return nonce === 0n && !isContract;
        }
    };
}

function evmAddress(address: ChainAddress): Address {
    if (!isEvmAddress(address)) {
        throw new Error(`${address} is not an EVM address`);
    }
    return address;
}

export const evmChainModule: ChainModule<TargetChainType> = {
    id: EVM_CHAIN_ID,
    chainTypes: TARGET_CHAIN_TYPES,
    connect: async ({ nodeUrl, chainType }) => evmChain(new TargetRpc(nodeUrl, chainType), chainType)
};
