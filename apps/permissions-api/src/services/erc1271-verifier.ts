import { type Address, encodeFunctionData, type Hex, hashTypedData, type PublicClient, zeroAddress } from 'viem';
import { areHexEqual } from '../utils/hex';
import type { PinoLogger } from '../utils/logger';

const IERC1271_ABI = [
    {
        type: 'function',
        name: 'isValidSignature',
        stateMutability: 'view',
        inputs: [
            { name: 'hash', type: 'bytes32' },
            { name: 'signature', type: 'bytes' }
        ],
        outputs: [{ name: 'magicValue', type: 'bytes4' }]
    }
] as const;

// The selector of isValidSignature(bytes32,bytes) is the magic value itself, so a contract that echoes
// its calldata passes a prefix comparison. Only the exact ABI-encoded bytes4 word counts as valid.
const ERC1271_MAGIC_VALUE = '0x1626ba7e' as const;
const ERC1271_VALID_RESPONSE: Hex = `${ERC1271_MAGIC_VALUE}${'00'.repeat(28)}`;

export class ERC1271Verifier {
    private client: PublicClient;
    private logger: PinoLogger;

    constructor(client: PublicClient, loggerInstance: PinoLogger) {
        this.client = client;
        this.logger = loggerInstance;
    }

    async verifySmartAccountSignature(
        signerContract: Address,
        message: string,
        signature: Hex,
        chainId: number
    ): Promise<boolean> {
        const domain = {
            name: 'AddressAssociationVerifier',
            version: '1.0.0',
            chainId,
            verifyingContract: zeroAddress
        } as const;

        const types = {
            AddressAssociation: [{ name: 'message', type: 'string' }]
        } as const;

        const digest = hashTypedData({
            domain,
            types,
            primaryType: 'AddressAssociation',
            message: {
                message
            }
        });

        const { data } = await this.client
            .call({
                to: signerContract,
                data: encodeFunctionData({
                    abi: IERC1271_ABI,
                    functionName: 'isValidSignature',
                    args: [digest, signature]
                })
            })
            .catch((error) => {
                this.logger.error(error, 'Failed to verify ERC1271 signature');
                return { data: undefined };
            });

        return data !== undefined && areHexEqual(data, ERC1271_VALID_RESPONSE);
    }
}
