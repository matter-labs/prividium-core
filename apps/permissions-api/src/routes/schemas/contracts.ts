import { z } from 'zod/v4';
import { storedChainAddressSchema } from '../../utils/schemas/address';
import { hexSchema } from '../../utils/schemas/hex-schema';

export const ContractAbiResponseSchema = z.object({
    contractAddress: storedChainAddressSchema,
    name: z.string().nullable(),
    abi: z.array(z.record(z.string(), z.unknown())),
    functions: z.array(
        z.object({
            selector: hexSchema,
            signature: z.string(),
            name: z.string(),
            accessType: z.enum(['read', 'write'])
        })
    )
});

export type ContractAbiResponse = z.infer<typeof ContractAbiResponseSchema>;
