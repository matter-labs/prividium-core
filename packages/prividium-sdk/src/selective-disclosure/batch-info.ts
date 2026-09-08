import { encodeAbiParameters, type Hex, pad, parseAbiParameters } from 'viem';

export function encodeBatchInfo(
    batchNumber: bigint,
    stateCommitment: Hex,
    numberOfLayer1Txs: bigint,
    priorityOperationsHash: Hex,
    l2ToL1LogsRootHash: Hex,
    commitment: Hex
): Hex {
    return encodeAbiParameters(
        parseAbiParameters('uint64, bytes32, uint64, uint256, bytes32, bytes32, bytes32, uint256, bytes32'),
        [
            batchNumber,
            stateCommitment as Hex,
            0n, // indexRepeatedStorageChanges
            numberOfLayer1Txs,
            priorityOperationsHash,
            pad('0x00'), // dependencyRootsRollingHash
            l2ToL1LogsRootHash,
            0n, // timestamp
            commitment
        ]
    );
}
