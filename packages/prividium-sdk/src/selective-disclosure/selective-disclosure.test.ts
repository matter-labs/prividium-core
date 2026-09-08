import { type Address, bytesToHex, type Hex, hexToBytes, keccak256, numberToHex, type PublicClient, pad } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { selectiveDisclosureActions } from './actions';
import { encodeBatchInfo } from './batch-info';
import type { EthCallDisclosureResult } from './disclosure-result';
import { computeStateCommitment } from './state-commitment';
import { blake2s256, concatBytes } from './utils';
import { calculateStateMerkleRoot, type ExistenceProof, type NonExistenceProof } from './verifiy-proofs';
import { verifyEthCallDisclosure } from './verify-disclosure';

// ---------------------------------------------------------------------------
// Realistic fixture data created using a local zksyncos instance
// ERC20 at 0x7859dCEA64A8f60D9ec8f31521574618D8aE8fe1, totalSupply() = 0x6e4
// ---------------------------------------------------------------------------

const contractAddress: Hex = '0x7859dcea64a8f60d9ec8f31521574618d8ae8fe1';

const proof = {
    address: contractAddress,
    stateCommitmentPreimage: {
        nextFreeSlot: '0x430' as Hex,
        blockNumber: '0x1da' as Hex,
        last256BlockHashesBlake: '0x7e2e68a1633628cf4ee6416a444a6af248e7cf975b3b744b6068beb14f8e98e4' as Hex,
        lastBlockTimestamp: '0x69dda64c' as Hex
    },
    storageProofs: [
        {
            key: '0x0000000000000000000000000000000000000000000000000000000000000003' as Hex,
            proof: {
                type: 'existing' as const,
                index: 691,
                value: '0x00000000000000000000000000000000000000000000000000000000000006e4' as Hex,
                nextIndex: 1056,
                siblings: [
                    '0xf213959a1eb05a45c92428937a15fbe3fafe196eac1fd7f6cd7b0aba9d37b00d',
                    '0x355510938b6d5e2bcc53a7a149603f1ca71e1f92fd83707adc0347ff81171ef9',
                    '0x7e766f023e65ee70d19afbca176f0c1867173fd589084ca9a5a5f2779cb59f21',
                    '0xf9d3516ec419f878ff91b9b8172dfa426095b531165af396efc122b5f2a35546',
                    '0x96a5b5be0ad23e46e7678e6c1757c71e0e4a7d481e5a2b48e66cb011a89b548d',
                    '0x2428afd0eca4d2f76cdff211e4e6d8cd216c9529b7eae1d7031c946d493871b3',
                    '0x5dc4b1e1f3316655232f5a4cd42fa365320ddcd9ee4eff7a8eecafaa0611d84d',
                    '0x8ab3e74cf7827b3175c13e92c85aa91efaca96ecd107a0845b52d9e160ceb523',
                    '0x8bc584a45ab31d09c84d8ce639e6cf4d243bf1f254c77f02818e937384055b67',
                    '0x19f92c60ad06eae009bcff6499489b45f27aff379ed54346d0c25175b9cd33c1',
                    '0xa887c4464ba696b2e95860ca1dd7ded86bcc1d4554ab231785b433cd6afbd059'
                ] as Hex[]
            }
        }
    ],
    l1VerificationData: {
        batchNumber: 175,
        numberOfLayer1Txs: 0,
        priorityOperationsHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' as Hex,
        dependencyRootsRollingHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
        l2ToL1LogsRootHash: '0x692f35c99f9c698852289ffecf07f6dd45770904521149d79aa85aae598fa375' as Hex,
        commitment: '0x9dbc02b99ea4c385ef2835c23affe9cf84004b946b107b2351eee54f2c641f9b' as Hex
    }
};

const expectedStateCommitment: Hex = '0x06145c3063f1fcc40a5fec4d98f89233b53ade16e1e841425d34baebc953baa4';
const expectedL1BatchHash: Hex = '0x2f487cd5b9b15ce08500e94faf7ad8860c94a73480bd1ea3701d0a5e3a860dcb';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculateStateMerkleRoot', () => {
    it('computes a consistent root from a real existence proof', () => {
        const sp = proof.storageProofs[0]!;
        const { treeRoot, value } = calculateStateMerkleRoot(sp.proof, proof.address, sp.key);

        expect(treeRoot).toBeDefined();
        expect(value).toEqual(sp.proof.value);
    });

    it('all storage proofs in a response produce the same root', () => {
        const roots = proof.storageProofs.map(
            (sp) => calculateStateMerkleRoot(sp.proof, proof.address, sp.key).treeRoot
        );

        expect(new Set(roots).size).toEqual(1);
    });

    it('throws when the proof index does not fit within the tree depth', () => {
        // The tree has depth 64, so any index >= 2^64 still has remaining bits
        // after walking the full path and should trip the invariant.
        // 2 ** 64 is exactly representable as a double, so BigInt(2 ** 64) === 2n ** 64n.
        const oversized: ExistenceProof = {
            type: 'existing',
            index: 2 ** 64,
            value: '0x00' as Hex,
            nextIndex: 0,
            siblings: []
        };

        expect(() => calculateStateMerkleRoot(oversized, contractAddress, '0x00' as Hex)).toThrow(
            /Merkle path walk did not reach root/
        );
    });

    // Mirrors the `hashLeaf` helper inside verifiy-proofs.ts so the test can build
    // leaf hashes that are internally consistent with the proofs it constructs.
    function hashLeaf(leafKey: Hex, value: Hex, nextIndex: bigint): Uint8Array {
        const nextIndexBytes = new Uint8Array(8);
        new DataView(nextIndexBytes.buffer).setBigUint64(0, nextIndex, true);
        return blake2s256(concatBytes(hexToBytes(leafKey), hexToBytes(value), nextIndexBytes));
    }

    // Builds a synthetic 2-leaf non-existence proof. The neighbors sit at indices
    // 0 and 1 (direct siblings at the leaf level); everything above depth 0 is
    // empty, so walkMerklePath pads with EMPTY_HASHES and both walks end at the
    // same root. The queried address/slot derives a flat key that is guaranteed
    // to fall strictly between leftLeafKey=0x00..00 and rightLeafKey=0xff..ff.
    function buildSiblingNonExistenceProof(overrides?: {
        leftNextIndex?: number;
        rightIndex?: number;
        leftSiblingOverride?: Hex;
        leftLeafKey?: Hex;
        rightLeafKey?: Hex;
    }): NonExistenceProof {
        const leftNextIndex = overrides?.leftNextIndex ?? 1;
        const rightIndex = overrides?.rightIndex ?? 1;

        const leftLeafKey = overrides?.leftLeafKey ?? (`0x${'00'.repeat(32)}` as Hex);
        const rightLeafKey = overrides?.rightLeafKey ?? (`0x${'ff'.repeat(32)}` as Hex);
        const leftValue = `0x${'aa'.repeat(32)}` as Hex;
        const rightValue = `0x${'bb'.repeat(32)}` as Hex;

        const leftLeafHash = hashLeaf(leftLeafKey, leftValue, BigInt(leftNextIndex));
        const rightLeafHash = hashLeaf(rightLeafKey, rightValue, 2n);

        return {
            type: 'nonExisting',
            leftNeighbor: {
                index: 0,
                leafKey: leftLeafKey,
                value: leftValue,
                nextIndex: leftNextIndex,
                siblings: [overrides?.leftSiblingOverride ?? bytesToHex(rightLeafHash)]
            },
            rightNeighbor: {
                index: rightIndex,
                leafKey: rightLeafKey,
                value: rightValue,
                nextIndex: 2,
                siblings: [bytesToHex(leftLeafHash)]
            }
        };
    }

    it('validates a non-existence proof and returns a null value', () => {
        const proof = buildSiblingNonExistenceProof();

        const { treeRoot, value } = calculateStateMerkleRoot(proof, contractAddress, pad('0x00'));

        expect(treeRoot).toMatch(/^0x[0-9a-f]{64}$/);
        expect(value).toBeNull();
    });

    it('throws when left and right neighbors walk to different tree roots', () => {
        // Tampering with the left-neighbor's depth-0 sibling makes its merkle
        // walk arrive at a different root than the right-neighbor's walk, which
        // still uses the true left-leaf hash at depth 0.
        const proof = buildSiblingNonExistenceProof({
            leftSiblingOverride: `0x${'de'.repeat(32)}` as Hex
        });

        expect(() => calculateStateMerkleRoot(proof, contractAddress, pad('0x00'))).toThrow(
            /left and right neighbors disagree on tree root/
        );
    });

    it('throws when the flat key is not strictly greater than the left neighbor key', () => {
        // leftLeafKey is the maximum 32-byte value, so the blake2s-derived flat
        // key cannot exceed it — `flatKey <= leftKey` must fire.
        const maxKey = `0x${'ff'.repeat(32)}` as Hex;
        const proof = buildSiblingNonExistenceProof({
            leftLeafKey: maxKey,
            rightLeafKey: maxKey
        });

        expect(() => calculateStateMerkleRoot(proof, contractAddress, pad('0x00'))).toThrow(
            /flat key .* not between left/
        );
    });

    it('throws when the flat key is not strictly less than the right neighbor key', () => {
        // rightLeafKey is the minimum 32-byte value, so the blake2s-derived
        // flat key cannot be below it — `flatKey >= rightKey` must fire.
        const minKey = `0x${'00'.repeat(32)}` as Hex;
        const proof = buildSiblingNonExistenceProof({
            leftLeafKey: minKey,
            rightLeafKey: minKey
        });

        expect(() => calculateStateMerkleRoot(proof, contractAddress, pad('0x00'))).toThrow(
            /flat key .* not between left/
        );
    });

    it('throws when a non-existence proof breaks linked-list continuity', () => {
        // Valid-looking proof except left.nextIndex (99) does not match right.index (1).
        // The leaf hash for left is recomputed with nextIndex=99 so the tree roots
        // still agree — which lets the linked-list invariant be the one that fires.
        const proof = buildSiblingNonExistenceProof({ leftNextIndex: 99 });

        expect(() => calculateStateMerkleRoot(proof, contractAddress, pad('0x00'))).toThrow(
            /left\.nextIndex \(99\) != right\.index \(1\)/
        );
    });
});

describe('computeStateCommitment', () => {
    it('produces the expected state commitment from real proof data', () => {
        const sp = proof.storageProofs[0]!;
        const { treeRoot } = calculateStateMerkleRoot(sp.proof, proof.address, sp.key);

        const commitment = computeStateCommitment(
            treeRoot,
            BigInt(proof.stateCommitmentPreimage.nextFreeSlot),
            BigInt(proof.stateCommitmentPreimage.blockNumber),
            proof.stateCommitmentPreimage.last256BlockHashesBlake,
            BigInt(proof.stateCommitmentPreimage.lastBlockTimestamp)
        );

        expect(commitment).toEqual(expectedStateCommitment);
    });
});

describe('encodeBatchInfo', () => {
    it('keccak256 of encoded batch info matches L1 storedBatchHash', () => {
        const encoded = encodeBatchInfo(
            BigInt(proof.l1VerificationData.batchNumber),
            expectedStateCommitment,
            BigInt(proof.l1VerificationData.numberOfLayer1Txs),
            proof.l1VerificationData.priorityOperationsHash,
            proof.l1VerificationData.l2ToL1LogsRootHash,
            proof.l1VerificationData.commitment
        );

        expect(keccak256(encoded)).toEqual(expectedL1BatchHash);
    });
});

describe('verifyEthCallDisclosure', () => {
    const callerAddress: Address = '0x000000000000000000000000000000000000c411';
    const disclosure: EthCallDisclosureResult = {
        result: numberToHex(BigInt('0x6e4')),
        from: callerAddress,
        to: contractAddress as Address,
        callData: '0x18160ddd',
        requiredBytecodes: [contractAddress as Address],
        batchNumber: 175,
        stateCommitmentPreimage: proof.stateCommitmentPreimage,
        l1VerificationData: proof.l1VerificationData,
        proofs: [
            {
                address: proof.address,
                storageProofs: proof.storageProofs
            }
        ]
    };

    const bytecodes: Record<Address, Hex> = {
        [contractAddress]: '0x6060' // dummy bytecode
    };

    function mockL2Client() {
        return {
            request: vi.fn().mockResolvedValue({
                success: true,
                reads: {},
                value: disclosure.result
            })
        };
    }

    function mockL1Client(storedHash: Hex) {
        return {
            readContract: vi.fn().mockResolvedValue(storedHash)
        };
    }

    it('returns true for valid disclosure data', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();
        // Tracer reports the same slot the disclosure proves — hex without
        // 0x prefix and without leading-zero padding, matching how the JS
        // tracer emits slot ids. The verifier compares via BigInt, so this
        // must equal the padded proof key 0x0000...0003.
        l2.request.mockResolvedValue({
            success: true,
            reads: {
                [contractAddress]: ['3']
            },
            value: disclosure.result
        });

        const { success: result } = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175
        });

        expect(result).toBe(true);
    });

    it('returns false when L1 batch hash does not match', async () => {
        const l1 = mockL1Client('0x0000000000000000000000000000000000000000000000000000000000000000');
        const l2 = mockL2Client();

        const { success: result } = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175
        });

        expect(result).toBe(false);
    });

    it('returns false when replay call returns different result', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();
        l2.request.mockResolvedValue({ success: true, reads: {}, value: '0x9999' });

        const { success: result } = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175
        });

        expect(result).toBe(false);
    });

    it('returns false when the trace itself fails', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();
        l2.request.mockResolvedValue({ success: false });

        const { success: result } = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175
        });

        expect(result).toBe(false);
    });

    it('returns false when the tracer reads a slot not present in the proofs', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();
        // The disclosure only proves slot 0x...0003. The tracer reports an
        // additional SLOAD on slot 0x9 — that read is unproven, so the
        // disclosure cannot be trusted and verification must return false.
        // (Slot strings are emitted without the 0x prefix, matching the JS
        // tracer's `log.stack.peek(0).toString(16)` output.)
        l2.request.mockResolvedValue({
            success: true,
            reads: {
                [contractAddress]: ['3', '9']
            },
            value: disclosure.result
        });

        const { success: result } = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175
        });

        expect(result).toBe(false);
    });

    it('returns false when the tracer reads a proven slot on a different contract', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();
        // Same slot index (0x3) is proven on `contractAddress`, but the tracer
        // reports the SLOAD coming from a different contract — that contract
        // has no proofs, so the read is unproven.
        const otherAddress: Address = '0x000000000000000000000000000000000000dead';
        l2.request.mockResolvedValue({
            success: true,
            reads: {
                [otherAddress]: ['3']
            },
            value: disclosure.result
        });

        const { success: result } = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175
        });

        expect(result).toBe(false);
    });

    it('throws when disclosure.proofs is empty', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();

        await expect(
            verifyEthCallDisclosure({
                disclosure: { ...disclosure, proofs: [] },
                l1Client: l1 as unknown as PublicClient,
                l2Client: l2 as unknown as PublicClient,
                diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
                contractBytecodes: bytecodes,
                batchNumber: 175
            })
        ).rejects.toThrow(/no proofs/);
    });

    it('throws when storage proofs walk to different merkle roots', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();

        // Clone the real storage proof but swap its depth-0 sibling so the walk
        // arrives at a different root than the original proof — their Set has
        // size 2, which must trip the consistency check.
        const originalStorageProof = proof.storageProofs[0]!;
        const tamperedSiblings = [...originalStorageProof.proof.siblings];
        tamperedSiblings[0] = `0x${'00'.repeat(32)}` as Hex;
        const tamperedStorageProof = {
            key: originalStorageProof.key,
            proof: {
                ...originalStorageProof.proof,
                siblings: tamperedSiblings
            }
        };

        await expect(
            verifyEthCallDisclosure({
                disclosure: {
                    ...disclosure,
                    proofs: [
                        {
                            address: proof.address,
                            storageProofs: [originalStorageProof, tamperedStorageProof]
                        }
                    ]
                },
                l1Client: l1 as unknown as PublicClient,
                l2Client: l2 as unknown as PublicClient,
                diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
                contractBytecodes: bytecodes,
                batchNumber: 175
            })
        ).rejects.toThrow(/multiple roots/);
    });

    it('throws when bytecode is missing for a contract in the proofs', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();

        await expect(
            verifyEthCallDisclosure({
                disclosure: disclosure,
                l1Client: l1 as unknown as PublicClient,
                l2Client: l2 as unknown as PublicClient,
                diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
                contractBytecodes: {},
                batchNumber: 175
            })
        ).rejects.toThrow('Missing bytecode');
    });

    it('throws when a required bytecode is not provided', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();

        const missingAddress: Address = '0x000000000000000000000000000000000000beef';

        await expect(
            verifyEthCallDisclosure({
                disclosure: { ...disclosure, requiredBytecodes: [contractAddress as Address, missingAddress] },
                l1Client: l1 as unknown as PublicClient,
                l2Client: l2 as unknown as PublicClient,
                diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
                contractBytecodes: bytecodes, // only has contractAddress
                batchNumber: 175
            })
        ).rejects.toThrow(`Missing bytecode for required contract ${missingAddress}`);
    });

    it('returns true when bytecode is provided for every required contract', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();
        l2.request.mockResolvedValue({
            success: true,
            reads: {
                [contractAddress]: ['3']
            },
            value: disclosure.result
        });
        // A second contract whose code ran during the call but that has no
        // storage proofs of its own. Its bytecode is still required for the replay.
        const codeOnlyAddress: Address = '0x000000000000000000000000000000000000beef';

        const { success: result } = await verifyEthCallDisclosure({
            disclosure: { ...disclosure, requiredBytecodes: [contractAddress as Address, codeOnlyAddress] },
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: { ...bytecodes, [codeOnlyAddress]: '0x6060' },
            batchNumber: 175
        });

        expect(result).toBe(true);
    });

    it('returns false when expectedTo does not match disclosure.to', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();

        const result = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175,
            expectedTo: '0x000000000000000000000000000000000000dead'
        });

        expect(result.success).toBe(false);
        expect(result).toMatchObject({ errorMsg: expect.stringContaining('"to"') });
        // The address read from the proof and the disclosure side must not have been queried —
        // the check is the first thing the function does, before touching L1.
        expect(l1.readContract).not.toHaveBeenCalled();
    });

    it('returns false when expectedCallData does not match disclosure.callData', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();

        const result = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175,
            expectedCallData: '0xdeadbeef'
        });

        expect(result.success).toBe(false);
        expect(l1.readContract).not.toHaveBeenCalled();
    });

    it('matches expectedTo and expectedCallData case-insensitively', async () => {
        const l1 = mockL1Client(expectedL1BatchHash);
        const l2 = mockL2Client();
        l2.request.mockResolvedValue({
            success: true,
            reads: { [contractAddress]: ['3'] },
            value: disclosure.result
        });

        const result = await verifyEthCallDisclosure({
            disclosure: disclosure,
            l1Client: l1 as unknown as PublicClient,
            l2Client: l2 as unknown as PublicClient,
            diamondAddress: '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef',
            contractBytecodes: bytecodes,
            batchNumber: 175,
            expectedTo: disclosure.to.toUpperCase() as Address,
            expectedCallData: disclosure.callData.toUpperCase() as Hex
        });

        expect(result.success).toBe(true);
    });
});

describe('selectiveDisclosureActions', () => {
    it('tokenSupplyDisclosure calls client.request with the correct schema', async () => {
        const mockClient = { request: vi.fn().mockResolvedValue({ result: '0x01' }) };
        const actions = selectiveDisclosureActions(mockClient as unknown as PublicClient);

        await actions.tokenSupplyDisclosure('0xabc' as Address, 100n);

        expect(mockClient.request).toHaveBeenCalledWith({
            method: 'prividium_tokenSupplyDisclosure',
            params: ['0xabc', numberToHex(100n)]
        });
    });

    it('tokenBalanceDisclosure calls client.request with the correct schema', async () => {
        const mockClient = { request: vi.fn().mockResolvedValue({ result: '0x01' }) };
        const actions = selectiveDisclosureActions(mockClient as unknown as PublicClient);

        await actions.tokenBalanceDisclosure('0xabc' as Address, '0xdef' as Address, 200n);

        expect(mockClient.request).toHaveBeenCalledWith({
            method: 'prividium_tokenBalanceDisclosure',
            params: ['0xabc', '0xdef', numberToHex(200n)]
        });
    });

    it('accountDataDisclosure calls client.request with the correct schema', async () => {
        const mockClient = { request: vi.fn().mockResolvedValue({ result: '0x01' }) };
        const actions = selectiveDisclosureActions(mockClient as unknown as PublicClient);

        await actions.accountDataDisclosure('0xabc' as Address, 300n);

        expect(mockClient.request).toHaveBeenCalledWith({
            method: 'prividium_accountDataDisclosure',
            params: ['0xabc', numberToHex(300n)]
        });
    });
});
