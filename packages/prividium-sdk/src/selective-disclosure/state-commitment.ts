import { bytesToHex, type Hex, hexToBytes } from 'viem';
import { blake2s256, concatBytes } from './utils.js';

export function computeStateCommitment(
    treeRoot: Hex,
    nextFreeSlot: bigint,
    blockNumber: bigint,
    last256BlockHashesBlake: Hex,
    lastBlockTimestamp: bigint
): Hex {
    const nextFreeSlotBytes = new Uint8Array(8);
    new DataView(nextFreeSlotBytes.buffer).setBigUint64(0, nextFreeSlot, false); // big-endian

    const blockNumberBytes = new Uint8Array(8);
    new DataView(blockNumberBytes.buffer).setBigUint64(0, blockNumber, false);

    const timestampBytes = new Uint8Array(8);
    new DataView(timestampBytes.buffer).setBigUint64(0, lastBlockTimestamp, false);

    const bytes = blake2s256(
        concatBytes(
            hexToBytes(treeRoot),
            nextFreeSlotBytes,
            blockNumberBytes,
            hexToBytes(last256BlockHashesBlake),
            timestampBytes
        )
    );
    return bytesToHex(bytes);
}
