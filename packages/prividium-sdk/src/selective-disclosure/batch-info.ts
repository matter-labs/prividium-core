import { encodeAbiParameters, type Hex, parseAbiParameters } from 'viem';

/**
 * Fields of the L1 `StoredBatchInfo` struct a disclosure carries.
 * Named rather than positional: five of the seven are `Hex`, so a transposition would
 * type-check and silently produce a hash that never matches `storedBatchHash`.
 */
export type BatchInfo = {
    batchNumber: bigint;
    stateCommitment: Hex;
    numberOfLayer1Txs: bigint;
    priorityOperationsHash: Hex;
    dependencyRootsRollingHash: Hex;
    l2ToL1LogsRootHash: Hex;
    commitment: Hex;
};

export function encodeBatchInfo({
    batchNumber,
    stateCommitment,
    numberOfLayer1Txs,
    priorityOperationsHash,
    dependencyRootsRollingHash,
    l2ToL1LogsRootHash,
    commitment
}: BatchInfo): Hex {
    return encodeAbiParameters(
        parseAbiParameters('uint64, bytes32, uint64, uint256, bytes32, bytes32, bytes32, uint256, bytes32'),
        [
            batchNumber,
            stateCommitment,
            0n, // indexRepeatedStorageChanges
            numberOfLayer1Txs,
            priorityOperationsHash,
            dependencyRootsRollingHash,
            l2ToL1LogsRootHash,
            0n, // timestamp
            commitment
        ]
    );
}
