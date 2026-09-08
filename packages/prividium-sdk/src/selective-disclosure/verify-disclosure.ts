import { type Address, type BlockTag, type Hex, keccak256, type PublicClient, pad, parseAbiItem } from 'viem';
import { encodeBatchInfo } from './batch-info.js';
import type { EthCallDisclosureResult } from './disclosure-result.js';
import { computeStateCommitment } from './state-commitment.js';
import { areHexEqual } from './utils.js';
import { calculateStateMerkleRoot } from './verifiy-proofs.js';

export const DIAMOND_ABI = [
    parseAbiItem('function storedBatchHash(uint256 _batchNumber) external view returns (bytes32)')
];

type DebugTxData = {
    from: Address;
    to: Address;
    data: Hex;
};

type AddressStateOverride = {
    code: Hex;
    state: Record<Hex, Hex>;
};

type StateOverride = Record<Address, AddressStateOverride>;

type Tracer = {
    tracer: string;
    stateOverrides: StateOverride;
};

type TracerResponse = { success: false } | { success: true; reads: Record<Hex, string[]>; value: Hex };

type DebugTraceCallAction = {
    Method: 'debug_traceCall';
    Parameters: [tx: DebugTxData, block: BlockTag | Hex, tracer: Tracer];
    ReturnType: TracerResponse;
};

const tracerStr = `{
    prevTop: null,
    state: {
        reads: {},success: null, value: null
    },
    step: function (log, _db) {
        if (log.op.toString() === 'SLOAD') {
            const addr = log.contract.getAddress();
            const slot = this.prevTop;
            if (!this.state.reads[addr]) this.state.reads[addr] = [];
            if (this.state.reads[addr].indexOf(slot) === -1) this.state.reads[addr].push(slot);
        }
        
        if (log.stack.length() > 0) {
            this.prevTop = log.stack.peek(0).toString(16);
        } else {
            this.prevTop = null;
        }
    },
    fault: (_log, _db) => {},
    result: function (ctx, _db) {
        this.state.success = ctx.error === null;
        this.state.value = ctx.output.toString('hex');
        return this.state;
    }
}`;

export type CallDisclosureResult =
    | {
          success: true;
      }
    | {
          success: false;
          errorMsg: string;
      };

type VerifyEthCallDisclosureParams = {
    disclosure: EthCallDisclosureResult;
    l1Client: PublicClient;
    l2Client: PublicClient;
    diamondAddress: Address;
    contractBytecodes: Record<Address, Hex>;
    batchNumber: number;
    expectedTo?: Address;
    expectedCallData?: Hex;
};

/**
 * Verifies an ethCall disclosure response end-to-end.
 *
 * Verification steps:
 * 1. Checks the caller supplied bytecode for every contract in `disclosure.requiredBytecodes`.
 * 2. Checks the disclosure's `to` and `callData` match `expectedTo` / `expectedCallData` when provided.
 * 3. Extracts Merkle roots from all storage proofs and checks they are consistent.
 * 4. Computes the state commitment from the tree root and preimage data.
 * 5. Encodes the batch info, hashes it, and compares against the L1 diamond proxy's `storedBatchHash`.
 * 6. Replays the original call on `l2Client` with state overrides (proven storage + bytecodes)
 *    and checks the result matches the disclosed value.
 *
 * Throws if the disclosure data is internally inconsistent (e.g. no proofs, divergent roots,
 * or missing bytecode for a contract listed in `disclosure.requiredBytecodes`).
 *
 * Returns `{ success: true }` if every check passes, otherwise `{ success: false, errorMsg }`.
 *
 * @param params - A single object holding all verification inputs:
 * @param params.disclosure - The response from `prividium_tokenSupplyDisclosure` or `prividium_tokenBalanceDisclosure`.
 * @param params.l1Client - A viem PublicClient connected to L1, used to read `storedBatchHash` from the diamond proxy.
 * @param params.l2Client - A viem PublicClient connected to a local L2 node trusted by the caller. Used to
 *   replay the disclosed call with state overrides. This must be a node the caller trusts, not the
 *   Prividium proxy, so the replay cannot be manipulated.
 * @param params.diamondAddress - The address of the L1 diamond proxy contract that stores batch commitments.
 * @param params.contractBytecodes - A mapping from contract address to deployed bytecode (hex). Must cover
 *   every address in `disclosure.requiredBytecodes`. Used for the call replay with state overrides.
 * @param params.batchNumber - The L1 batch number the disclosure was computed against.
 * @param params.expectedTo - Optional. The address the disclosed call was expected to target; when set,
 *   verification fails if it does not match `disclosure.to` (case-insensitive).
 * @param params.expectedCallData - Optional. The calldata the disclosed call was expected to use; when
 *   set, verification fails if it does not match `disclosure.callData` (case-insensitive).
 */
export async function verifyEthCallDisclosure({
    disclosure,
    l1Client,
    l2Client,
    diamondAddress,
    contractBytecodes,
    batchNumber,
    expectedTo,
    expectedCallData
}: VerifyEthCallDisclosureParams): Promise<CallDisclosureResult> {
    const normalizedBytecodes: Record<Address, Hex> = Object.entries(contractBytecodes).reduce(
        (obj, [key, value]) => {
            obj[key.toLowerCase() as Hex] = value;
            return obj;
        },
        {} as Record<Address, Hex>
    );

    // Step 1: The disclosure lists every contract whose bytecode executed during
    // the traced call. The caller must supply bytecode for each of them; replaying
    // against an incomplete set would not faithfully reproduce the original call.
    for (const required of disclosure.requiredBytecodes) {
        if (normalizedBytecodes[required.toLowerCase() as Hex] === undefined) {
            throw new Error(`Missing bytecode for required contract ${required.toLowerCase()}`);
        }
    }

    // Step 2: Verify expected data match

    if (expectedTo !== undefined && !areHexEqual(expectedTo, disclosure.to)) {
        return { success: false, errorMsg: '"to" field doesn\'t match with expected value' };
    }

    if (expectedCallData !== undefined && !areHexEqual(expectedCallData, disclosure.callData)) {
        return { success: false, errorMsg: '"callData" field doesn\'t match with expected value' };
    }

    // Step 3: Extract Merkle roots from all storage proofs and verify they're consistent.
    const roots: Hex[] = [];
    for (const proof of disclosure.proofs) {
        for (const storageProof of proof.storageProofs) {
            const { treeRoot } = calculateStateMerkleRoot(storageProof.proof, proof.address, storageProof.key);
            roots.push(treeRoot);
        }
    }

    if (roots.length === 0) {
        throw new Error('Inconsistent data: no proofs');
    }

    if (new Set(roots).size !== 1) {
        throw new Error('Inconsistent data: multiple roots for same batch');
    }

    // Step 4: Compute state commitment from the tree root + preimage data.
    const stateCommitment = computeStateCommitment(
        roots[0]!,
        BigInt(disclosure.stateCommitmentPreimage.nextFreeSlot),
        BigInt(disclosure.stateCommitmentPreimage.blockNumber),
        disclosure.stateCommitmentPreimage.last256BlockHashesBlake,
        BigInt(disclosure.stateCommitmentPreimage.lastBlockTimestamp)
    );

    // Step 5: Encode batch info and keccak256 hash it.
    const batchInfoHex = encodeBatchInfo(
        BigInt(batchNumber),
        stateCommitment,
        BigInt(disclosure.l1VerificationData.numberOfLayer1Txs),
        disclosure.l1VerificationData.priorityOperationsHash,
        disclosure.l1VerificationData.l2ToL1LogsRootHash,
        disclosure.l1VerificationData.commitment
    );
    const batchInfoHash = keccak256(batchInfoHex);

    // Step 6: Verify against L1 diamond proxy.
    const storedBatchHash = await l1Client
        .readContract({
            address: diamondAddress,
            abi: DIAMOND_ABI,
            functionName: 'storedBatchHash',
            args: [BigInt(batchNumber)]
        })
        .catch((e) => {
            throw new Error('Error reading l1 diamond', { cause: e });
        });

    if (!areHexEqual(batchInfoHash, storedBatchHash)) {
        return { success: false, errorMsg: 'L1 batch commitment does not match the proof data' };
    }

    // Step 7: Replay the call on L2 with state overrides to verify the proven
    // and debug capabilities storage values produce the expected result using the same slots.
    const contractAddress = disclosure.to;

    const stateOverride: StateOverride = {};
    for (const proof of disclosure.proofs) {
        const address = proof.address.toLowerCase() as Address;
        const code = normalizedBytecodes[address];
        if (!code) {
            throw new Error(`Missing bytecode for contract ${address}`);
        }

        const state: Record<Hex, Hex> = {};
        for (const sp of proof.storageProofs) {
            state[sp.key] = sp.proof.type === 'existing' ? sp.proof.value : pad('0x0');
        }

        stateOverride[address] = {
            code,
            state: state
        };
    }

    const debugResult = await l2Client.request<DebugTraceCallAction>({
        method: 'debug_traceCall',
        params: [
            {
                from: disclosure.from,
                to: contractAddress,
                data: disclosure.callData
            },
            'latest',
            {
                tracer: tracerStr,
                stateOverrides: stateOverride
            }
        ]
    });

    if (!debugResult.success) {
        return { success: false, errorMsg: 'Error during simulated call' };
    }

    // 8. Check that no slot reads were outside the expected proven slots.
    for (const address in debugResult.reads) {
        for (const slot of debugResult.reads[address as Hex]!) {
            const realSlot = `0x${slot}`;
            const exists = disclosure.proofs.find(
                (p) =>
                    areHexEqual(p.address, address as Hex) &&
                    p.storageProofs.some((sp) => BigInt(sp.key) === BigInt(realSlot))
            );
            if (!exists) {
                return {
                    success: false,
                    errorMsg: `Missing slot in provided proofs: ${realSlot}`
                };
            }
        }
    }

    if (BigInt(debugResult.value) === BigInt(disclosure.result)) {
        return { success: true };
    } else {
        return {
            success: false,
            errorMsg: `Simulated call did not match with expected value. Expected: ${disclosure.result}, received: ${debugResult.value}`
        };
    }
}
