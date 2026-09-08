import {
    type Address,
    bytesToHex,
    getAddress,
    type Hex,
    hexToBigInt,
    hexToBytes,
    keccak256,
    type PublicClient,
    pad
} from 'viem';
import { encodeBatchInfo } from './batch-info.js';
import type { AccountDataDisclosureResult, AccountProperties } from './disclosure-result.js';
import { computeStateCommitment } from './state-commitment.js';
import { areHexEqual, blake2s256 } from './utils.js';
import { calculateStateMerkleRoot } from './verifiy-proofs.js';
import { DIAMOND_ABI } from './verify-disclosure.js';

const PUSH1 = 0x60;
const PUSH32 = 0x7f;
const JUMPDEST = 0x5b;
const BYTECODE_ALIGNMENT = 8;

export function encodeAccountProperties(params: AccountProperties): Hex {
    const buf = new Uint8Array(124);
    const view = new DataView(buf.buffer);

    view.setBigUint64(0, hexToBigInt(params.versioningData), false);
    view.setBigUint64(8, hexToBigInt(params.nonce), false);

    // Balance as 32 bytes big-endian
    const balanceHex = hexToBigInt(params.balance).toString(16).padStart(64, '0');
    for (let i = 0; i < 32; i++) {
        buf[16 + i] = parseInt(balanceHex.slice(i * 2, i * 2 + 2), 16);
    }

    buf.set(hexToBytes(params.bytecodeHash), 48);
    view.setUint32(80, params.unpaddedCodeLen, false);
    view.setUint32(84, params.artifactsLen, false);
    buf.set(hexToBytes(params.observableBytecodeHash), 88);
    view.setUint32(120, params.observableBytecodeLen, false);

    return bytesToHex(buf);
}

/**
 * Compute the internal bytecode hash: blake2s(code || padding || artifacts)
 * Returns { bytecodeHash, artifactsLen }
 */
export function computeInternalBytecodeHash(codeHex: Hex): {
    bytecodeHash: Hex;
    artifactsLen: number;
} {
    const code = hexToBytes(codeHex);
    const paddingLen = computeBytecodePaddingLen(code.length);
    const artifacts = computeJumpdestBitmap(code);

    const fullLen = code.length + paddingLen + artifacts.length;
    const buf = new Uint8Array(fullLen); // zero-initialized (padding is zeros)
    buf.set(code, 0);
    buf.set(artifacts, code.length + paddingLen);

    return {
        bytecodeHash: bytesToHex(blake2s256(buf)),
        artifactsLen: artifacts.length
    };
}

const ACCOUNT_PROPERTIES_ADDRESS = '0x0000000000000000000000000000000000008003' as const;

export type VerifyAccountPropertiesResult = { success: true } | { success: false; errorMsg: string };

export async function verifyAccountPropertiesProof(
    disclosure: AccountDataDisclosureResult,
    l1Client: PublicClient,
    diamondAddress: Address,
    expectedBytecode?: Hex,
    expectedAddress?: Hex
): Promise<VerifyAccountPropertiesResult> {
    const isEoa = BigInt(disclosure.accountProperties.bytecodeHash) === 0n;
    if (isEoa && expectedBytecode !== undefined && BigInt(expectedBytecode) !== 0n) {
        return { success: false, errorMsg: 'EOA should not have bytecode' };
    }

    if (!isEoa) {
        if (expectedBytecode === undefined) {
            return { success: false, errorMsg: 'Missing expected bytecode for contract' };
        }
        const { bytecodeHash: computedHash } = computeInternalBytecodeHash(expectedBytecode);
        if (!areHexEqual(computedHash, disclosure.accountProperties.bytecodeHash)) {
            return { success: false, errorMsg: "Bytecode hash doesn't match" };
        }
    }

    if (expectedAddress !== undefined && !areHexEqual(expectedAddress, disclosure.address)) {
        return {
            success: false,
            errorMsg: `Disclosure address does not match with expected address. Expected ${getAddress(expectedAddress)}, included in disclosure payload: ${getAddress(disclosure.address)} `
        };
    }

    const { treeRoot, value: propertiesHash } = calculateStateMerkleRoot(
        disclosure.storageProof,
        ACCOUNT_PROPERTIES_ADDRESS,
        pad(disclosure.address)
    );

    const encodedProperties = encodeAccountProperties(disclosure.accountProperties);

    const reconstructedHash = blake2s256(hexToBytes(encodedProperties));

    if (propertiesHash === null || !areHexEqual(bytesToHex(reconstructedHash), propertiesHash)) {
        return { success: false, errorMsg: "Account properties hash doesn't match the storage proof value" };
    }

    // Step 2: Compute state commitment from the tree root + preimage data.
    const stateCommitment = computeStateCommitment(
        treeRoot,
        BigInt(disclosure.stateCommitmentPreimage.nextFreeSlot),
        BigInt(disclosure.stateCommitmentPreimage.blockNumber),
        disclosure.stateCommitmentPreimage.last256BlockHashesBlake,
        BigInt(disclosure.stateCommitmentPreimage.lastBlockTimestamp)
    );

    const batchInfoHex = encodeBatchInfo(
        BigInt(disclosure.batchNumber),
        stateCommitment,
        BigInt(disclosure.l1VerificationData.numberOfLayer1Txs),
        disclosure.l1VerificationData.priorityOperationsHash,
        disclosure.l1VerificationData.l2ToL1LogsRootHash,
        disclosure.l1VerificationData.commitment
    );
    const batchInfoHash = keccak256(batchInfoHex);

    // Step 4: Verify against L1 diamond proxy.
    const storedBatchHash = await l1Client.readContract({
        address: diamondAddress,
        abi: DIAMOND_ABI,
        functionName: 'storedBatchHash',
        args: [BigInt(disclosure.batchNumber)]
    });

    const success = areHexEqual(batchInfoHash, storedBatchHash);
    if (success) {
        return { success: true };
    } else {
        return { success: false, errorMsg: 'Storage proof verification failed.' };
    }
}

/**
 * Build the JUMPDEST bitmap matching the ZKsync OS evm_interpreter `analyze()`.
 * The bitmap is stored as u64 words in little-endian byte order.
 */
function computeJumpdestBitmap(code: Uint8Array): Uint8Array {
    // Number of u64 words needed: ceil(code.length / 64)
    const u64Count = Math.ceil(code.length / 64) || 0;
    const bitmap = new Uint8Array(u64Count * 8); // zero-initialized

    let i = 0;
    while (i < code.length) {
        const op = code[i]!;
        if (op === JUMPDEST) {
            // Set bit at position i in the little-endian u64 bitmap.
            // Word index (in u64 terms): Math.floor(i / 64)
            // Bit within that u64: i % 64
            // Byte within that u64 (little-endian): Math.floor((i % 64) / 8)
            // Bit within that byte: (i % 64) % 8
            const byteIndex = Math.floor(i / 64) * 8 + Math.floor((i % 64) / 8);
            const bitIndex = (i % 64) % 8;
            bitmap[byteIndex]! |= 1 << bitIndex;
            i += 1;
        } else if (op >= PUSH1 && op <= PUSH32) {
            i += 1 + (op - PUSH1 + 1);
        } else {
            i += 1;
        }
    }

    return bitmap;
}

function computeBytecodePaddingLen(codeLen: number): number {
    const rem = codeLen % BYTECODE_ALIGNMENT;
    return rem === 0 ? 0 : BYTECODE_ALIGNMENT - rem;
}
