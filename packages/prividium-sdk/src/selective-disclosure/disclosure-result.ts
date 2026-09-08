import type { Address, Hex } from 'viem';
import type { StorageSlotProof } from './verifiy-proofs.js';

export type StateCommitmentPreimage = {
    nextFreeSlot: Hex;
    blockNumber: Hex;
    last256BlockHashesBlake: Hex;
    lastBlockTimestamp: Hex;
};

export type L1VerificationData = {
    batchNumber: number;
    numberOfLayer1Txs: number;
    priorityOperationsHash: Hex;
    dependencyRootsRollingHash: Hex;
    l2ToL1LogsRootHash: Hex;
    commitment: Hex;
};

export type StorageProof = {
    key: Hex;
    proof: StorageSlotProof;
};

export type AccountStorageProofs = {
    address: Hex;
    storageProofs: StorageProof[];
};

/**
 * Shared response shape returned by all token-related selective-disclosure
 * RPC methods (`prividium_tokenSupplyDisclosure`, `prividium_tokenBalanceDisclosure`).
 */
export type EthCallDisclosureResult = {
    result: Hex;
    from: Address;
    to: Address;
    callData: Hex;
    requiredBytecodes: Address[];
    batchNumber: number;
    stateCommitmentPreimage: StateCommitmentPreimage;
    l1VerificationData: L1VerificationData;
    proofs: AccountStorageProofs[];
};

export type AccountProperties = {
    versioningData: Hex;
    nonce: Hex;
    balance: Hex;
    bytecodeHash: Hex;
    unpaddedCodeLen: number;
    artifactsLen: number;
    observableBytecodeHash: Hex;
    observableBytecodeLen: number;
};

export type AccountDataDisclosureResult = {
    accountProperties: AccountProperties;
    address: Address;
    bytecode: Hex;
    batchNumber: number;
    l1VerificationData: L1VerificationData;
    stateCommitmentPreimage: StateCommitmentPreimage;
    storageProof: StorageSlotProof;
};
