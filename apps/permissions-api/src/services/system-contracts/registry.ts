import type { Address } from 'viem';
import { getAddress, parseAbi } from 'viem';
import type { contractsTable } from '../../db/schema';

/**
 * A system contract definition as stored in the hardcoded registry.
 * Timestamps are excluded because they are managed by the database.
 */
export type SystemContractDefinition = Omit<typeof contractsTable.$inferSelect, 'createdAt' | 'updatedAt'>;

/**
 * Narrower system contract definition to force some values without modifying the external type.
 */
type NarrowSystemContractDefinition = SystemContractDefinition & { isSystemContract: true };

/**
 * Hardcoded registry of system contracts.
 * To add a new system contract, append an entry to this array.
 */
export const SYSTEM_CONTRACTS_REGISTRY: readonly SystemContractDefinition[] = [
    // ETH withdrawals on protocol v31 only; v33 routes them through InteropCenter.sendBundle.
    {
        contractAddress: '0x000000000000000000000000000000000000800A',
        abi: JSON.stringify([
            {
                type: 'function',
                name: 'withdraw',
                inputs: [{ name: '_l1Receiver', internalType: 'address', type: 'address' }],
                outputs: [],
                stateMutability: 'payable'
            }
        ]),
        name: 'L2BaseToken',
        description: 'Handles the network’s main token, including transfers back to L1',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    // ERC-20 withdrawals on protocol v31 only; v33 routes them through InteropCenter.sendBundle.
    {
        contractAddress: '0x0000000000000000000000000000000000010003',
        abi: JSON.stringify([
            {
                type: 'function',
                name: 'l1TokenAddress',
                inputs: [{ name: '_l2Token', internalType: 'address', type: 'address' }],
                outputs: [{ name: '', internalType: 'address', type: 'address' }],
                stateMutability: 'view'
            },
            {
                type: 'function',
                name: 'withdraw',
                inputs: [
                    { name: '_assetId', internalType: 'bytes32', type: 'bytes32' },
                    { name: '_assetData', internalType: 'bytes', type: 'bytes' }
                ],
                outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
                stateMutability: 'nonpayable'
            }
        ]),
        name: 'L2AssetRouter',
        description: 'Routes supported assets through the network’s bridge flows.',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    // ERC-20 withdrawals: zksync-js calls ensureTokenIsRegistered(token) to register the token and retrieve its assetId before routing through L2AssetRouter.
    {
        contractAddress: '0x0000000000000000000000000000000000010004',
        abi: JSON.stringify([
            {
                type: 'function',
                inputs: [],
                name: 'BASE_TOKEN_ASSET_ID',
                outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
                stateMutability: 'view'
            },
            {
                type: 'function',
                inputs: [],
                name: 'L1_CHAIN_ID',
                outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
                stateMutability: 'view'
            },
            {
                type: 'function',
                inputs: [],
                name: 'WETH_TOKEN',
                outputs: [{ name: '', internalType: 'address', type: 'address' }],
                stateMutability: 'view'
            },
            {
                type: 'function',
                inputs: [{ name: '_l1Token', internalType: 'address', type: 'address' }],
                name: 'l2TokenAddress',
                outputs: [{ name: '', internalType: 'address', type: 'address' }],
                stateMutability: 'view'
            },
            {
                type: 'function',
                inputs: [{ name: '_token', internalType: 'address', type: 'address' }],
                name: 'assetId',
                outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
                stateMutability: 'view'
            },
            {
                type: 'function',
                inputs: [{ name: 'assetId', internalType: 'bytes32', type: 'bytes32' }],
                name: 'originChainId',
                outputs: [{ name: 'originChainId', internalType: 'uint256', type: 'uint256' }],
                stateMutability: 'view'
            },
            {
                type: 'function',
                name: 'ensureTokenIsRegistered',
                inputs: [{ name: '_nativeToken', internalType: 'address', type: 'address' }],
                outputs: [{ name: 'tokenAssetId', internalType: 'bytes32', type: 'bytes32' }],
                stateMutability: 'nonpayable'
            }
        ]),
        name: 'L2NativeTokenVault',
        description: 'Keeps track of registered native assets used by the bridge',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    // ETH and ERC-20 withdrawals on protocol v33+: one L1-bound bundle through sendBundle.
    {
        contractAddress: '0x000000000000000000000000000000000001000d',
        abi: JSON.stringify([
            {
                type: 'function',
                name: 'sendBundle',
                inputs: [
                    { name: '_destinationChainId', internalType: 'bytes', type: 'bytes' },
                    {
                        name: '_callStarters',
                        internalType: 'struct InteropCallStarter[]',
                        type: 'tuple[]',
                        components: [
                            { name: 'to', internalType: 'bytes', type: 'bytes' },
                            { name: 'data', internalType: 'bytes', type: 'bytes' },
                            { name: 'callAttributes', internalType: 'bytes[]', type: 'bytes[]' }
                        ]
                    },
                    { name: '_bundleAttributes', internalType: 'bytes[]', type: 'bytes[]' }
                ],
                outputs: [{ name: 'bundleHash', internalType: 'bytes32', type: 'bytes32' }],
                stateMutability: 'payable'
            },
            {
                type: 'function',
                name: 'isInteropBundleSaltUsed',
                inputs: [
                    { name: 'user', internalType: 'address', type: 'address' },
                    { name: 'salt', internalType: 'bytes32', type: 'bytes32' }
                ],
                outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
                stateMutability: 'view'
            }
        ]),
        name: 'InteropCenter',
        description: 'Sends cross-chain bundles, including L2→L1 withdrawals on protocol v33 and later',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    {
        contractAddress: '0x0000000000000000000000000000000000010002',
        abi: JSON.stringify(parseAbi(['function baseTokenAssetId(uint256 chainId) view returns (bytes32)'])),
        name: 'L2Bridgehub',
        description: 'Resolves chain base-token assets during bridging',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    {
        contractAddress: '0x0000000000000000000000000000000000010015',
        abi: JSON.stringify(
            parseAbi([
                'function parseAttributes(bytes[] _attributes, uint8 _restriction) pure returns ((uint256 interopCallValue, uint256 indirectCallMessageValue, bool indirectCall) callAttributes, (bytes executionAddress, bytes unbundlerAddress, bool useFixedFee, bytes32 salt) bundleAttributes)',
                'function parseAtomicSend(bytes[] _attributes) pure returns (((bytes1 version, uint64 deadline, uint256 settlementLayerChainId, bytes32[] legBundleHashes, uint256[] legSourceChainIds) flowPreimage, uint256 lowNullifierIndex, bool isAtomic) atomicSend)'
            ])
        ),
        name: 'L2InteropAttributeParser',
        description: 'Parses attributes of cross-chain calls and bundles',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    {
        contractAddress: '0x0000000000000000000000000000000000010011',
        abi: JSON.stringify(parseAbi(['function burnAndStartBridging(uint256 _toChainId) payable'])),
        name: 'L2BaseTokenHolder',
        description: 'Burns the network base token when initiating a withdrawal',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    {
        contractAddress: '0x000000000000000000000000000000000001000f',
        abi: JSON.stringify(
            parseAbi([
                'function handleInitiateBaseTokenBridgingOnL2(uint256 _toChainId, uint256 _amount)',
                'function handleInitiateBridgingOnL2(uint256 _toChainId, bytes32 _assetId, uint256 _amount, uint256 _tokenOriginChainId)',
                'function interopInfo(bytes32 assetId) view returns (uint256 totalWithdrawalsToL1, uint256 totalSuccessfulDepositsFromL1)',
                'function chainBalance(uint256 chainId, bytes32 assetId) view returns (uint256 balance)',
                'function totalPreV31TotalSupply(bytes32 assetId) view returns (bool isSaved, uint256 amount)',
                'function isAssetRegistered(bytes32 assetId) view returns (bool isAssetRegistered)'
            ])
        ),
        name: 'L2AssetTracker',
        description: 'Tracks asset balances moving between chains',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    {
        contractAddress: '0x000000000000000000000000000000000000800B',
        abi: JSON.stringify(parseAbi(['function currentSettlementLayerChainId() view returns (uint256)'])),
        name: 'SystemContext',
        description: 'Provides the current settlement-layer chain ID to the bridge',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    {
        contractAddress: '0x0000000000000000000000000000000000008008',
        abi: JSON.stringify(parseAbi(['function sendToL1(bytes _message) returns (bytes32)'])),
        name: 'L1Messenger',
        description: 'Sends withdrawal messages to L1',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    },
    {
        contractAddress: '0x0000000000000000000000000000000000007001',
        abi: JSON.stringify([]),
        name: 'L1MessengerHook',
        description: 'Hook invoked while sending messages to L1',
        discloseBytecode: false,
        discloseErc20TotalSupply: false,
        isSystemContract: true,
        organizationId: null,
        templateId: null,
        disclosureStartBlock: '0x0'
    }
] satisfies NarrowSystemContractDefinition[];

const systemContractAddresses: ReadonlySet<string> = new Set(
    SYSTEM_CONTRACTS_REGISTRY.map((c) => getAddress(c.contractAddress).toLowerCase())
);

export function isSystemContractAddress(address: Address): boolean {
    return systemContractAddresses.has(address.toLowerCase());
}
