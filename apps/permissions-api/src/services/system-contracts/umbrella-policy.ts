import { type Address, type Hex, toFunctionSelector } from 'viem';

type UmbrellaPolicy = {
    methods: readonly string[];
    optionalReads?: readonly string[];
    allowEmptyCalldata?: boolean;
};

export const SYSTEM_CONTRACT_UMBRELLA_POLICIES: Readonly<Record<Address, UmbrellaPolicy>> = {
    '0x0000000000000000000000000000000000010002': {
        methods: ['baseTokenAssetId(uint256)']
    },
    '0x0000000000000000000000000000000000010015': {
        methods: ['parseAttributes(bytes[],uint8)', 'parseAtomicSend(bytes[])']
    },
    '0x0000000000000000000000000000000000010011': {
        methods: ['burnAndStartBridging(uint256)']
    },
    '0x000000000000000000000000000000000001000f': {
        methods: [
            'handleInitiateBaseTokenBridgingOnL2(uint256,uint256)',
            'handleInitiateBridgingOnL2(uint256,bytes32,uint256,uint256)'
        ],
        optionalReads: [
            'interopInfo(bytes32)',
            'chainBalance(uint256,bytes32)',
            'totalPreV31TotalSupply(bytes32)',
            'isAssetRegistered(bytes32)'
        ]
    },
    '0x000000000000000000000000000000000000800B': {
        methods: ['currentSettlementLayerChainId()']
    },
    '0x0000000000000000000000000000000000008008': {
        methods: ['sendToL1(bytes)'],
        // ZKsync OS burns message gas with an empty self-call; the contract rejects other callers.
        allowEmptyCalldata: true
    }
};

const selectorsByAddress = new Map(
    Object.entries(SYSTEM_CONTRACT_UMBRELLA_POLICIES).map(([address, policy]) => [
        address.toLowerCase(),
        {
            methods: new Set(policy.methods.map(toFunctionSelector)),
            optionalReads: new Set(policy.optionalReads?.map(toFunctionSelector)),
            allowEmptyCalldata: policy.allowEmptyCalldata ?? false
        }
    ])
);

export function canInheritSystemContractUmbrella(address: Address, selector: Hex, allowSystemReads: boolean): boolean {
    const policy = selectorsByAddress.get(address.toLowerCase());
    if (!policy) return true;
    const normalizedSelector = selector.toLowerCase() as Hex;
    return (
        policy.methods.has(normalizedSelector) ||
        (normalizedSelector === '0x' && policy.allowEmptyCalldata) ||
        (allowSystemReads && policy.optionalReads.has(normalizedSelector))
    );
}
