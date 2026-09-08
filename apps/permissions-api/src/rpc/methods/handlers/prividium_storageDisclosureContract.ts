import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { hexSchema } from '../../../utils/schemas/hex-schema';
import { ForbiddenRpcError, WrongArguments } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { response } from '../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';

export const storageDisclosureParamsSchema = z.tuple([
    z.object({
        contract: addressSchema, // Contract address
        storageSlots: z.array(hexSchema), // Array of storage slot keys
        l1BatchNumber: hexSchema.optional() // Optional batch number
    })
]);

export const storageProofSchema = z.object({
    storageProof: z.array(
        z.object({
            key: hexSchema,
            proof: z.array(hexSchema),
            value: hexSchema,
            index: z.number()
        })
    )
});

export const prividium_storageDisclosureContract: MethodHandler<
    AuthorizedRpcContext,
    typeof storageDisclosureParamsSchema
> = {
    name: 'prividium_storageDisclosureContract',
    paramsSchema: storageDisclosureParamsSchema,
    async handle(context, _method, params, id): Promise<JsonRpcResponse> {
        // Parse and validate parameters
        const [{ contract, storageSlots }] = params;

        // Check permissions for each storage slot
        for (const slot of storageSlots) {
            // Check if user has permission to read this specific storage slot
            if (!(await context.authorizer.checkStorageRead(contract, slot))) {
                throw new ForbiddenRpcError(`Storage access denied for contract ${contract}, slot ${slot}`);
            }
        }

        // All permission checks passed, execute the storage disclosure
        const result = await handleStorageDisclosure(context, params, id);
        return response({ id, result });
    }
};

// Storage disclosure implementation logic that will be used by the wrapper
async function handleStorageDisclosure(
    context: AuthorizedRpcContext,
    params: z.infer<typeof storageDisclosureParamsSchema>,
    id: number | string
) {
    const [{ contract, storageSlots, l1BatchNumber }] = params;

    // Validate storage slots are non-empty
    if (storageSlots.length === 0) {
        throw new WrongArguments('At least one storage slot must be provided');
    }

    // Get batch number if not provided
    const batchNumber =
        l1BatchNumber ?? (await context.targetRpc.send(`${id}_l1BatchNumber`, 'zks_L1BatchNumber', [], hexSchema));

    // Call zks_getProof with the contract and storage slots
    const getProofId = `${id}_getProof`;
    const methodName = 'zks_getProof';
    const methodParams = [contract, storageSlots, Number(batchNumber)];
    const proofResponse = await context.targetRpc.send(getProofId, methodName, methodParams, storageProofSchema);

    // Validate we got proofs for all requested slots
    // storageProof is an array with one entry per storage slot, where each entry contains:
    // - key: the storage slot
    // - proof: array of merkle proof nodes (up to 255) for that slot
    // - value: the value at that slot
    // - index: position in the tree
    if (proofResponse.storageProof.length !== storageSlots.length) {
        throw new Error('Invalid rpc response: missing storage proofs', {
            cause: { id: getProofId, method: methodName, params: methodParams }
        });
    }

    // Transform the response into a more structured format
    const storageDisclosures = proofResponse.storageProof.map((proof) => ({
        slot: proof.key,
        value: proof.value,
        proof: {
            path: proof.proof,
            index: proof.index
        }
    }));

    return {
        contract,
        batchNumber: batchNumber,
        storageDisclosures: storageDisclosures
    };
}
