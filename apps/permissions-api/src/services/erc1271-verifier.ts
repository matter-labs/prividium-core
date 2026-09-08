import { type Address, type Hex, hashTypedData, type PublicClient, zeroAddress } from 'viem';
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

const ERC1271_MAGIC_VALUE = '0x1626ba7e' as const;

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

        const magicValue = await this.client
            .readContract({
                abi: IERC1271_ABI,
                address: signerContract,
                functionName: 'isValidSignature',
                args: [digest, signature]
            })
            .catch((error) => {
                this.logger.error(error, 'Failed to verify ERC1271 signature');
                return '';
            });

        return magicValue.toLowerCase() === ERC1271_MAGIC_VALUE;
    }
}
