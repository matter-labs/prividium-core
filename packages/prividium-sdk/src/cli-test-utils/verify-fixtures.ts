import { type Address, bytesToHex, type Hex, hexToBytes, keccak256, numberToHex, pad, zeroAddress } from 'viem';
import {
    type AccountDataDisclosureResult,
    type AccountProperties,
    calculateStateMerkleRoot,
    computeInternalBytecodeHash,
    computeStateCommitment,
    type EthCallDisclosureResult,
    type ExistenceProof,
    encodeAccountProperties,
    encodeBatchInfo
} from '../selective-disclosure';
import { blake2s256 } from '../selective-disclosure/utils.js';

// Snapshot of real data produced by a local zksyncos instance, kept in sync
// with src/selective-disclosure/selective-disclosure.test.ts. Updating one
// set means updating both — the data is frozen real-chain output.

export const CONTRACT_ADDRESS: Address = '0x7859dcea64a8f60d9ec8f31521574618d8ae8fe1';
export const TOKEN_TOTAL_SUPPLY = BigInt('0x6e4');
export const BATCH_NUMBER = 175;
export const DIAMOND_ADDRESS: Address = '0x18f438bc08d755e164a7ae7c077e2ea93b0179ef';
export const EXPECTED_L1_BATCH_HASH: Hex = '0x2f487cd5b9b15ce08500e94faf7ad8860c94a73480bd1ea3701d0a5e3a860dcb';

export const CALL_DISCLOSURE: EthCallDisclosureResult = {
    result: numberToHex(TOKEN_TOTAL_SUPPLY),
    callData: '0x18160ddd',
    from: zeroAddress,
    to: CONTRACT_ADDRESS,
    requiredBytecodes: [CONTRACT_ADDRESS],
    batchNumber: BATCH_NUMBER,
    stateCommitmentPreimage: {
        nextFreeSlot: '0x430',
        blockNumber: '0x1da',
        last256BlockHashesBlake: '0x7e2e68a1633628cf4ee6416a444a6af248e7cf975b3b744b6068beb14f8e98e4',
        lastBlockTimestamp: '0x69dda64c'
    },
    l1VerificationData: {
        batchNumber: BATCH_NUMBER,
        numberOfLayer1Txs: 0,
        priorityOperationsHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        dependencyRootsRollingHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        l2ToL1LogsRootHash: '0x692f35c99f9c698852289ffecf07f6dd45770904521149d79aa85aae598fa375',
        commitment: '0x9dbc02b99ea4c385ef2835c23affe9cf84004b946b107b2351eee54f2c641f9b'
    },
    proofs: [
        {
            address: CONTRACT_ADDRESS,
            storageProofs: [
                {
                    key: '0x0000000000000000000000000000000000000000000000000000000000000003',
                    proof: {
                        type: 'existing',
                        index: 691,
                        value: '0x00000000000000000000000000000000000000000000000000000000000006e4',
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
                        ]
                    }
                }
            ]
        }
    ]
};

export const BYTECODES: Record<Address, Hex> = {
    [CONTRACT_ADDRESS]: '0x6060'
};

export const BYTECODES_CLI_ARG = `${CONTRACT_ADDRESS}:${BYTECODES[CONTRACT_ADDRESS]}`;

// ---------------------------------------------------------------------------
// Account-data disclosure fixture — derived deterministically from
// AccountProperties using the same helpers as src/selective-disclosure/
// account-properties.test.ts.
// ---------------------------------------------------------------------------

const ACCOUNT_PROPERTIES_CONTRACT: Hex = '0x0000000000000000000000000000000000008003';
export const ACCOUNT_DATA_BATCH_NUMBER = 42;
export const ACCOUNT_BYTECODE: Hex = '0x60005b';

export const ACCOUNT_PROPERTIES: AccountProperties = {
    versioningData: '0x0101010000000000',
    nonce: '0x05',
    balance: '0xde0b6b3a7640000',
    bytecodeHash: computeInternalBytecodeHash(ACCOUNT_BYTECODE).bytecodeHash,
    unpaddedCodeLen: 3,
    artifactsLen: 8,
    observableBytecodeHash: keccak256(ACCOUNT_BYTECODE),
    observableBytecodeLen: 3
};

const accountDataStateCommitmentPreimage = {
    nextFreeSlot: '0x10' as Hex,
    blockNumber: '0x20' as Hex,
    last256BlockHashesBlake: `0x${'11'.repeat(32)}` as Hex,
    lastBlockTimestamp: '0x30' as Hex
};

const accountDataL1VerificationData = {
    batchNumber: ACCOUNT_DATA_BATCH_NUMBER,
    numberOfLayer1Txs: 3,
    priorityOperationsHash: `0x${'22'.repeat(32)}` as Hex,
    dependencyRootsRollingHash: `0x${'00'.repeat(32)}` as Hex,
    l2ToL1LogsRootHash: `0x${'33'.repeat(32)}` as Hex,
    commitment: `0x${'44'.repeat(32)}` as Hex
};

const accountPropertiesHash = bytesToHex(blake2s256(hexToBytes(encodeAccountProperties(ACCOUNT_PROPERTIES))));

const accountDataStorageProof: ExistenceProof = {
    type: 'existing',
    index: 0,
    value: accountPropertiesHash,
    nextIndex: 1,
    siblings: []
};

export const ACCOUNT_DATA_DISCLOSURE: AccountDataDisclosureResult = {
    accountProperties: ACCOUNT_PROPERTIES,
    address: CONTRACT_ADDRESS,
    batchNumber: ACCOUNT_DATA_BATCH_NUMBER,
    l1VerificationData: accountDataL1VerificationData,
    stateCommitmentPreimage: accountDataStateCommitmentPreimage,
    storageProof: accountDataStorageProof,
    bytecode: '0x'
};

const { treeRoot: accountDataTreeRoot } = calculateStateMerkleRoot(
    accountDataStorageProof,
    ACCOUNT_PROPERTIES_CONTRACT,
    pad(CONTRACT_ADDRESS)
);

const accountDataStateCommitment = computeStateCommitment(
    accountDataTreeRoot,
    BigInt(accountDataStateCommitmentPreimage.nextFreeSlot),
    BigInt(accountDataStateCommitmentPreimage.blockNumber),
    accountDataStateCommitmentPreimage.last256BlockHashesBlake,
    BigInt(accountDataStateCommitmentPreimage.lastBlockTimestamp)
);

export const ACCOUNT_DATA_L1_BATCH_HASH: Hex = keccak256(
    encodeBatchInfo(
        BigInt(ACCOUNT_DATA_BATCH_NUMBER),
        accountDataStateCommitment,
        BigInt(accountDataL1VerificationData.numberOfLayer1Txs),
        accountDataL1VerificationData.priorityOperationsHash,
        accountDataL1VerificationData.l2ToL1LogsRootHash,
        accountDataL1VerificationData.commitment
    )
);
