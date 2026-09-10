import type { Address } from 'viem';
import { getAddress } from 'viem';
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
    // ETH withdrawals: zksync-js calls withdraw(address) on this contract to initiate an L2→L1 ETH transfer.
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
    // ERC-20 withdrawals: zksync-js calls withdraw(assetId, assetData) here to burn tokens on L2 and send the L2→L1 message.
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
    // Protocol v32+ withdrawals: zksync-js sends an L2→L1 bundle through InteropCenter.
    {
        contractAddress: '0x000000000000000000000000000000000001000d',
        abi: JSON.stringify([
            {
                type: 'function',
                name: 'sendBundle',
                inputs: [
                    { name: '_destinationChainId', type: 'bytes' },
                    {
                        name: '_callStarters',
                        type: 'tuple[]',
                        components: [
                            { name: 'to', type: 'bytes' },
                            { name: 'data', type: 'bytes' },
                            { name: 'callAttributes', type: 'bytes[]' }
                        ]
                    },
                    { name: '_bundleAttributes', type: 'bytes[]' }
                ],
                outputs: [{ name: 'bundleHash', type: 'bytes32' }],
                stateMutability: 'payable'
            }
        ]),
        name: 'InteropCenter',
        description: 'Sends interop bundles, including withdrawals to L1',
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
