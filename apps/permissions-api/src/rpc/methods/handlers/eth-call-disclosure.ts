import { type Address, type Hex, numberToHex, pad } from 'viem';
import type { BlockTag } from '../../../utils/schemas/block-tag';
import type { DisclosureConfig } from '../../permissions';
import type { AuthorizedRpcContext } from '../../rpc-service';
import type { ZksGetProofResponse } from '../../target-rpc';
import { assertBlockAfterDisclosureStart } from './disclosure-helpers';
import { tracerResultSchema, tracerStr } from './tracer';

/**
 * Shared token-disclosure flow: debug-traces a read-only call on the token
 * contract, accumulates the storage slots touched during execution, gathers a
 * `zks_getProof` for each (contract, slots) pair, and returns the structured
 * disclosure response used by `prividium_tokenSupplyDisclosure` and
 * `prividium_tokenBalanceDisclosure`. The caller passes the disclosure config
 * resolved by its auth check; this function enforces the `disclosureStartBlock`
 * floor against the resolved block.
 */
export async function ethCallDisclosure(
    context: AuthorizedRpcContext,
    id: number | string,
    tokenAddress: Hex,
    callData: Hex,
    block: BlockTag | Hex,
    disclosure: DisclosureConfig,
    from: Address
) {
    const { batchNumber, blockNumber } = await context.targetRpc.batchForBlock(`${id}_batchNumber`, block);
    assertBlockAfterDisclosureStart(blockNumber, disclosure.disclosureStartBlock);

    const res = await context.targetRpc.debugCall(
        `${id}_traceCall`,
        from,
        tokenAddress,
        callData,
        blockNumber,
        tracerStr,
        tracerResultSchema
    );

    if (!res.success) {
        throw new Error('call failed');
    }

    const returnedValue = BigInt(res.value);

    const proofs: ZksGetProofResponse[] = [];
    for (const contract in res.reads) {
        const slots = res.reads[contract as Hex]!;
        const proof = await context.targetRpc.getProf(
            `${id}_proof_${contract}`,
            contract as Hex,
            slots.map((s) => numberToHex(BigInt(`0x${s}`))).map((hex) => pad(hex)),
            batchNumber
        );

        proofs.push(proof);
    }

    if (proofs.length === 0) {
        throw new Error('Empty proofs');
    }

    return {
        result: numberToHex(returnedValue),
        from,
        to: tokenAddress,
        callData,
        requiredBytecodes: res.addresses,
        batchNumber,
        stateCommitmentPreimage: proofs[0]!.stateCommitmentPreimage,
        l1VerificationData: proofs[0]!.l1VerificationData,
        proofs: proofs.map((p) => ({
            address: p.address,
            storageProofs: p.storageProofs
        }))
    };
}
