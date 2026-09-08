import { type Address, bytesToHex, type Hex, hexToBytes, keccak256, type PublicClient, pad } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import {
    computeInternalBytecodeHash,
    encodeAccountProperties,
    verifyAccountPropertiesProof
} from './account-properties';
import { encodeBatchInfo } from './batch-info';
import type { AccountDataDisclosureResult, AccountProperties } from './disclosure-result';
import { computeStateCommitment } from './state-commitment';
import { blake2s256 } from './utils';
import { calculateStateMerkleRoot, type ExistenceProof } from './verifiy-proofs';

const ZERO_32 = `0x${'00'.repeat(32)}` as Hex;

function baseProperties(overrides: Partial<AccountProperties> = {}): AccountProperties {
    return {
        versioningData: '0x0',
        nonce: '0x0',
        balance: '0x0',
        bytecodeHash: ZERO_32,
        unpaddedCodeLen: 0,
        artifactsLen: 0,
        observableBytecodeHash: ZERO_32,
        observableBytecodeLen: 0,
        ...overrides
    };
}

describe('encodeAccountProperties', () => {
    it('produces a 124-byte hex output', () => {
        const encoded = encodeAccountProperties(baseProperties());
        expect(encoded).toHaveLength(2 + 124 * 2);
    });

    it('emits all zero bytes for a zero-valued account', () => {
        expect(encodeAccountProperties(baseProperties())).toBe(`0x${'00'.repeat(124)}`);
    });

    it('lays each field out at its canonical byte offset', () => {
        const properties = baseProperties({
            versioningData: '0x0101010000000000',
            nonce: '0x0000000000000005',
            balance: '0x1234',
            bytecodeHash: `0x${'aa'.repeat(32)}`,
            unpaddedCodeLen: 100,
            artifactsLen: 32,
            observableBytecodeHash: `0x${'bb'.repeat(32)}`,
            observableBytecodeLen: 100
        });

        const bytes = hexToBytes(encodeAccountProperties(properties));

        expect(bytes.byteLength).toBe(124);
        // bytes 0-7: versioningData as u64 big-endian
        expect(bytesToHex(bytes.slice(0, 8))).toBe('0x0101010000000000');
        // bytes 8-15: nonce as u64 big-endian
        expect(bytesToHex(bytes.slice(8, 16))).toBe('0x0000000000000005');
        // bytes 16-47: balance as u256 big-endian
        expect(bytesToHex(bytes.slice(16, 48))).toBe(`0x${'00'.repeat(30)}1234`);
        // bytes 48-79: internal bytecode hash
        expect(bytesToHex(bytes.slice(48, 80))).toBe(`0x${'aa'.repeat(32)}`);
        // bytes 80-83: unpaddedCodeLen as u32 big-endian
        expect(bytesToHex(bytes.slice(80, 84))).toBe('0x00000064');
        // bytes 84-87: artifactsLen as u32 big-endian
        expect(bytesToHex(bytes.slice(84, 88))).toBe('0x00000020');
        // bytes 88-119: observable bytecode hash
        expect(bytesToHex(bytes.slice(88, 120))).toBe(`0x${'bb'.repeat(32)}`);
        // bytes 120-123: observableBytecodeLen as u32 big-endian
        expect(bytesToHex(bytes.slice(120, 124))).toBe('0x00000064');
    });

    it('left-pads small balances to fill the 32-byte slot', () => {
        const bytes = hexToBytes(encodeAccountProperties(baseProperties({ balance: '0x01' })));
        expect(bytesToHex(bytes.slice(16, 48))).toBe(`0x${'00'.repeat(31)}01`);
    });

    it('encodes a full 32-byte balance without truncation', () => {
        const maxBalance = `0x${'ff'.repeat(32)}` as Hex;
        const bytes = hexToBytes(encodeAccountProperties(baseProperties({ balance: maxBalance })));
        expect(bytesToHex(bytes.slice(16, 48))).toBe(maxBalance);
    });
});

describe('computeInternalBytecodeHash', () => {
    it('hashes empty code with no artifacts', () => {
        const { bytecodeHash, artifactsLen } = computeInternalBytecodeHash('0x');
        expect(artifactsLen).toBe(0);
        expect(bytecodeHash).toBe(bytesToHex(blake2s256(new Uint8Array(0))));
    });

    it('pads code up to the 8-byte alignment before hashing', () => {
        // Single STOP opcode — 1 byte of code, 7 bytes zero padding, 8 zero bitmap bytes.
        const { bytecodeHash, artifactsLen } = computeInternalBytecodeHash('0x00');
        expect(artifactsLen).toBe(8);
        expect(bytecodeHash).toBe(bytesToHex(blake2s256(new Uint8Array(16))));
    });

    it('leaves the bitmap empty when no JUMPDEST is present', () => {
        const code = pad('0x', { size: 4 });
        const { bytecodeHash, artifactsLen } = computeInternalBytecodeHash(code);
        expect(artifactsLen).toBe(8);
        // 8 zero bytes of code + 8 zero bitmap bytes
        expect(bytecodeHash).toBe(bytesToHex(blake2s256(new Uint8Array(16))));
    });

    it('sets a bit in the bitmap for a JUMPDEST at position 0', () => {
        const { bytecodeHash, artifactsLen } = computeInternalBytecodeHash('0x5b');
        expect(artifactsLen).toBe(8);

        const buf = new Uint8Array(16);
        buf[0] = 0x5b;
        buf[8] = 0x01; // bit 0 of the first u64 word
        expect(bytecodeHash).toBe(bytesToHex(blake2s256(buf)));
    });

    it('treats bytes inside PUSH data as data, not opcodes', () => {
        // PUSH1 0x5b — the 0x5b is push data and must NOT be marked as a JUMPDEST.
        const { bytecodeHash, artifactsLen } = computeInternalBytecodeHash('0x605b');
        expect(artifactsLen).toBe(8);

        const buf = new Uint8Array(16);
        buf[0] = 0x60;
        buf[1] = 0x5b;
        // bitmap all zeros
        expect(bytecodeHash).toBe(bytesToHex(blake2s256(buf)));
    });

    it('sets a bit for a JUMPDEST appearing right after a PUSH sequence', () => {
        // PUSH1 0x00 then JUMPDEST at byte index 2.
        const { bytecodeHash, artifactsLen } = computeInternalBytecodeHash('0x60005b');
        expect(artifactsLen).toBe(8);

        const buf = new Uint8Array(16);
        buf[0] = 0x60;
        buf[1] = 0x00;
        buf[2] = 0x5b;
        buf[8] = 0x04; // bit 2 set — position (2 % 64) inside the first u64 word, little-endian
        expect(bytecodeHash).toBe(bytesToHex(blake2s256(buf)));
    });

    it('grows the bitmap to multiple u64 words for code longer than 64 bytes', () => {
        // 65 bytes: 64 STOPs followed by a JUMPDEST at byte index 64.
        const code = `0x${'00'.repeat(64)}5b` as Hex;
        const { bytecodeHash, artifactsLen } = computeInternalBytecodeHash(code);
        // ceil(65 / 64) = 2 words → 16 bytes of artifacts
        expect(artifactsLen).toBe(16);

        // fullLen = 65 (code) + 7 (padding to multiple of 8) + 16 (bitmap) = 88
        const buf = new Uint8Array(88);
        buf[64] = 0x5b;
        // byteIndex = floor(64/64)*8 + floor((64 % 64)/8) = 8
        // bitIndex  = (64 % 64) % 8 = 0
        // bitmap lives at offset 65 + 7 = 72
        buf[72 + 8] = 0x01;
        expect(bytecodeHash).toBe(bytesToHex(blake2s256(buf)));
    });
});

describe('verifyAccountPropertiesProof', () => {
    const diamondAddress = '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef' as Address;
    const address = '0x7859dcea64a8f60d9ec8f31521574618d8ae8fe1' as Address;
    const accountPropertiesContract = '0x0000000000000000000000000000000000008003' as Hex;
    const bytecode: Hex = '0x60005b';
    const { bytecodeHash } = computeInternalBytecodeHash(bytecode);

    const properties: AccountProperties = {
        versioningData: '0x0101010000000000',
        nonce: '0x05',
        balance: '0xde0b6b3a7640000',
        bytecodeHash,
        unpaddedCodeLen: 3,
        artifactsLen: 8,
        observableBytecodeHash: keccak256(bytecode),
        observableBytecodeLen: 3
    };

    // Build a self-consistent disclosure: the storage-proof value is
    // blake2s(encodeAccountProperties(properties)), so the hash reconstructed
    // inside verifyAccountPropertiesProof matches. The L1 client is mocked to
    // return the batch hash we compute from the same fixture.
    function buildFixture(accountProperties: AccountProperties) {
        const encoded = encodeAccountProperties(accountProperties);
        const propertiesHash = bytesToHex(blake2s256(hexToBytes(encoded)));

        const storageProof: ExistenceProof = {
            type: 'existing',
            index: 0,
            value: propertiesHash,
            nextIndex: 1,
            siblings: []
        };

        const stateCommitmentPreimage = {
            nextFreeSlot: '0x10' as Hex,
            blockNumber: '0x20' as Hex,
            last256BlockHashesBlake: `0x${'11'.repeat(32)}` as Hex,
            lastBlockTimestamp: '0x30' as Hex
        };

        const batchNumber = 42;

        const l1VerificationData = {
            batchNumber,
            numberOfLayer1Txs: 3,
            priorityOperationsHash: `0x${'22'.repeat(32)}` as Hex,
            dependencyRootsRollingHash: ZERO_32,
            l2ToL1LogsRootHash: `0x${'33'.repeat(32)}` as Hex,
            commitment: `0x${'44'.repeat(32)}` as Hex
        };

        const disclosure: AccountDataDisclosureResult = {
            accountProperties,
            address,
            batchNumber,
            l1VerificationData,
            stateCommitmentPreimage,
            storageProof,
            bytecode
        };

        const { treeRoot } = calculateStateMerkleRoot(storageProof, accountPropertiesContract, pad(address));
        const stateCommitment = computeStateCommitment(
            treeRoot,
            BigInt(stateCommitmentPreimage.nextFreeSlot),
            BigInt(stateCommitmentPreimage.blockNumber),
            stateCommitmentPreimage.last256BlockHashesBlake,
            BigInt(stateCommitmentPreimage.lastBlockTimestamp)
        );
        const expectedBatchHash = keccak256(
            encodeBatchInfo(
                BigInt(batchNumber),
                stateCommitment,
                BigInt(l1VerificationData.numberOfLayer1Txs),
                l1VerificationData.priorityOperationsHash,
                l1VerificationData.l2ToL1LogsRootHash,
                l1VerificationData.commitment
            )
        );

        return { disclosure, expectedBatchHash };
    }

    function mockL1(storedHash: Hex) {
        return {
            readContract: vi.fn().mockResolvedValue(storedHash)
        } as unknown as PublicClient;
    }

    it('returns true for a self-consistent disclosure', async () => {
        const { disclosure, expectedBatchHash } = buildFixture(properties);
        const l1 = mockL1(expectedBatchHash);

        expect(await verifyAccountPropertiesProof(disclosure, l1, diamondAddress, disclosure.bytecode)).toEqual({
            success: true
        });
    });

    it('returns true when the supplied bytecode matches bytecodeHash', async () => {
        const { disclosure, expectedBatchHash } = buildFixture(properties);
        const l1 = mockL1(expectedBatchHash);

        expect(await verifyAccountPropertiesProof(disclosure, l1, diamondAddress, bytecode)).toEqual({ success: true });
    });

    it('returns false when the supplied bytecode does not hash to bytecodeHash', async () => {
        const { disclosure, expectedBatchHash } = buildFixture(properties);
        const l1 = mockL1(expectedBatchHash);

        expect(await verifyAccountPropertiesProof(disclosure, l1, diamondAddress, '0xff')).toEqual({
            success: false,
            errorMsg: "Bytecode hash doesn't match"
        });
    });

    it('short-circuits on bytecode mismatch without calling L1', async () => {
        const { disclosure, expectedBatchHash } = buildFixture(properties);
        const l1 = mockL1(expectedBatchHash);

        await verifyAccountPropertiesProof(disclosure, l1, diamondAddress, '0xff');

        expect(l1.readContract).not.toHaveBeenCalled();
    });

    it('returns false when account properties are tampered with', async () => {
        const { disclosure, expectedBatchHash } = buildFixture(properties);
        const l1 = mockL1(expectedBatchHash);

        const tampered: AccountDataDisclosureResult = {
            ...disclosure,
            accountProperties: { ...disclosure.accountProperties, balance: '0xfafafa' }
        };

        expect(await verifyAccountPropertiesProof(tampered, l1, diamondAddress, disclosure.bytecode)).toEqual({
            success: false,
            errorMsg: "Account properties hash doesn't match the storage proof value"
        });
    });

    it('returns false when L1 returns a different batch hash', async () => {
        const { disclosure } = buildFixture(properties);
        const l1 = mockL1(ZERO_32);

        expect(await verifyAccountPropertiesProof(disclosure, l1, diamondAddress, disclosure.bytecode)).toEqual({
            success: false,
            errorMsg: 'Storage proof verification failed.'
        });
    });
});
