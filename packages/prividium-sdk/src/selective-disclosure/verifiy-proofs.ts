import { bytesToHex, type Hex, hexToBytes, pad } from 'viem';
import { blake2s256, concatBytes } from './utils.js';

export type StorageRoot = { treeRoot: Hex; value: Hex | null };

function deriveFlatKey(address: Hex, storageKey: Hex): Uint8Array {
    // blake2s(pad32(address) || storageKey)
    const addressBytes = hexToBytes(pad(address));
    const keyBytes = hexToBytes(storageKey as `0x${string}`);
    return blake2s256(concatBytes(addressBytes, keyBytes));
}

function hashLeaf(leafKey: Uint8Array, value: Uint8Array, nextIndex: bigint): Uint8Array {
    // blake2s(leafKey || value || nextIndex.to_le_bytes(8))
    const nextIndexBytes = new Uint8Array(8);
    const view = new DataView(nextIndexBytes.buffer);
    view.setBigUint64(0, nextIndex, true); // little-endian
    return blake2s256(concatBytes(leafKey, value, nextIndexBytes));
}

export interface ExistenceProof {
    type: 'existing';
    index: number;
    value: Hex;
    nextIndex: number;
    siblings: Hex[];
}

export interface NonExistenceProof {
    type: 'nonExisting';
    leftNeighbor: {
        index: number;
        leafKey: Hex;
        value: Hex;
        nextIndex: number;
        siblings: Hex[];
    };
    rightNeighbor: {
        index: number;
        leafKey: Hex;
        value: Hex;
        nextIndex: number;
        siblings: Hex[];
    };
}

export type StorageSlotProof = ExistenceProof | NonExistenceProof;

const TREE_DEPTH = 64;

function computeEmptyHashes(): Uint8Array[] {
    const hashes: Uint8Array[] = new Array(TREE_DEPTH);
    // emptyHash[0] = blake2s(0x00{72}) — empty leaf (key=0, value=0, next=0)
    hashes[0] = blake2s256(new Uint8Array(72));
    for (let i = 1; i < TREE_DEPTH; i++) {
        hashes[i] = blake2s256(concatBytes(hashes[i - 1]!, hashes[i - 1]!));
    }
    return hashes;
}

const EMPTY_HASHES = computeEmptyHashes();

function walkMerklePath(leafHash: Uint8Array, index: bigint, siblings: Uint8Array[]): Uint8Array {
    // Pad siblings with empty hashes if shorter than TREE_DEPTH
    const fullPath: Uint8Array[] = [...siblings];
    for (let i = siblings.length; i < TREE_DEPTH; i++) {
        fullPath.push(EMPTY_HASHES[i]!);
    }

    let current = leafHash;
    let idx = index;

    for (let i = 0; i < TREE_DEPTH; i++) {
        const sibling = fullPath[i]!;
        if (idx % 2n === 0n) {
            current = blake2s256(concatBytes(current, sibling));
        } else {
            current = blake2s256(concatBytes(sibling, current));
        }
        idx = idx / 2n;
    }

    if (idx !== 0n) {
        throw new Error(`Merkle path walk did not reach root: remaining index = ${idx}`);
    }
    return current;
}

export function calculateStateMerkleRoot(proof: StorageSlotProof, address: Hex, storageSlot: Hex): StorageRoot {
    if (proof.type === 'existing') {
        const existenceProof = proof;
        const flatKey = deriveFlatKey(address, storageSlot);
        const siblings = existenceProof.siblings.map((s) => hexToBytes(s));
        const leaf = hashLeaf(flatKey, hexToBytes(existenceProof.value), BigInt(existenceProof.nextIndex));
        const root = walkMerklePath(leaf, BigInt(existenceProof.index), siblings);
        return { treeRoot: bytesToHex(root), value: existenceProof.value };
    } else {
        const nonExistenceProof = proof;
        const flatKey = deriveFlatKey(address, storageSlot);

        const leftSiblings = nonExistenceProof.leftNeighbor.siblings.map((s) => hexToBytes(s));
        const leftLeaf = hashLeaf(
            hexToBytes(nonExistenceProof.leftNeighbor.leafKey),
            hexToBytes(nonExistenceProof.leftNeighbor.value),
            BigInt(nonExistenceProof.leftNeighbor.nextIndex)
        );
        const leftRoot = walkMerklePath(leftLeaf, BigInt(nonExistenceProof.leftNeighbor.index), leftSiblings);

        const rightSiblings = nonExistenceProof.rightNeighbor.siblings.map((s) => hexToBytes(s));
        const rightLeaf = hashLeaf(
            hexToBytes(nonExistenceProof.rightNeighbor.leafKey),
            hexToBytes(nonExistenceProof.rightNeighbor.value),
            BigInt(nonExistenceProof.rightNeighbor.nextIndex)
        );
        const rightRoot = walkMerklePath(rightLeaf, BigInt(nonExistenceProof.rightNeighbor.index), rightSiblings);

        // Both neighbors must agree on the tree root
        if (bytesToHex(leftRoot) !== bytesToHex(rightRoot)) {
            throw new Error('Non-existing proof: left and right neighbors disagree on tree root');
        }

        // Verify the queried key falls between the neighbors
        const flatKeyHex = bytesToHex(flatKey);
        const leftKeyHex = nonExistenceProof.leftNeighbor.leafKey.toLowerCase();
        const rightKeyHex = nonExistenceProof.rightNeighbor.leafKey.toLowerCase();
        if (flatKeyHex <= leftKeyHex || flatKeyHex >= rightKeyHex) {
            throw new Error(
                `Non-existing proof: flat key ${flatKeyHex} not between left ${leftKeyHex} and right ${rightKeyHex}`
            );
        }

        // Verify linked list continuity
        if (nonExistenceProof.leftNeighbor.nextIndex !== nonExistenceProof.rightNeighbor.index) {
            throw new Error(
                `Non-existing proof: left.nextIndex (${nonExistenceProof.leftNeighbor.nextIndex}) != right.index (${nonExistenceProof.rightNeighbor.index})`
            );
        }

        return { treeRoot: bytesToHex(leftRoot), value: null };
    }
}
