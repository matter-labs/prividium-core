import { computeInternalBytecodeHash } from '@repo/prividium-sdk';
import { keccak256, numberToHex, pad, size } from 'viem';
import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { blockTagSchema } from '../../../utils/schemas/block-tag';
import { ForbiddenRpcError } from '../../errors';
import type { JsonRpcResponse } from '../../json-rpc';
import { response } from '../../json-rpc';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import { assertBlockAfterDisclosureStart } from './disclosure-helpers';

const paramsSchema = z.tuple([addressSchema, blockTagSchema]);

// VersioningData byte layout (u64, big-endian):
//   byte 0 (MSB): deployment_status (1 = deployed, 2 = delegated)
//   byte 1: EE version (1 = EVM)
//   byte 2: code version (1 = artifacts caching)
//   bytes 3-7: aux bitmasks + reserved (0)
// source: https://github.com/matter-labs/zksync-os/blob/main/basic_system/src/system_implementation/flat_storage_model/account_cache_entry.rs#L17-L29
const VERSIONING_DEPLOYED_EVM: bigint =
    (1n << 56n) | // deployment_status = 1 (DEPLOYED)
    (1n << 48n) | // ee_version = 1 (EVM)
    (1n << 40n); // code_version = 1 (ARTIFACTS_CACHING)

const VERSIONING_EOA: bigint = 0n;

const ACCOUNT_PROPERTIES_ADDRESS = '0x0000000000000000000000000000000000008003' as const;

/**
 * Selective disclosure methods do not require a valid jwt.
 */
export const prividium_accountDataDisclosure: MethodHandler<AuthorizedRpcContext, typeof paramsSchema> = {
    name: 'prividium_accountDataDisclosure',
    paramsSchema,
    async handle(context, _method, params, id): Promise<JsonRpcResponse> {
        const [address, blockTag] = params;

        const disclosure = await context.authorizer.getBytecodeDisclosureConfig(address);
        if (!disclosure) {
            throw new ForbiddenRpcError(`Address ${address} does not disclose bytecode`);
        }

        const { batchNumber, blockNumber } = await context.targetRpc.batchForBlock(`${id}_batchNumber`, blockTag);
        assertBlockAfterDisclosureStart(blockNumber, disclosure.disclosureStartBlock);

        const balance = await context.targetRpc.getBalanceFor(`${id}_getBalance`, address, blockNumber);
        const code = await context.targetRpc.getCodeFor(`${id}_getCode`, address, blockNumber);
        const isContract = code !== '0x';

        const nonce = await context.targetRpc.nonceFor(address, `${id}_getTransactionCount`, blockNumber);

        const proof = await context.targetRpc.getProf(
            `${id}_proof`,
            ACCOUNT_PROPERTIES_ADDRESS,
            [pad(address)],
            batchNumber
        );

        const { bytecodeHash, artifactsLen } = isContract
            ? computeInternalBytecodeHash(code)
            : { bytecodeHash: pad('0x'), artifactsLen: 0 };

        const versioning = isContract ? VERSIONING_DEPLOYED_EVM : VERSIONING_EOA;

        return response({
            id,
            result: {
                accountProperties: {
                    versioningData: numberToHex(versioning),
                    nonce: numberToHex(nonce),
                    balance: balance,
                    bytecodeHash: bytecodeHash,
                    unpaddedCodeLen: size(code),
                    artifactsLen: artifactsLen,
                    observableBytecodeHash: isContract ? keccak256(code) : pad('0x'),
                    observableBytecodeLen: size(code)
                },
                address,
                bytecode: code,
                batchNumber,
                l1VerificationData: proof.l1VerificationData,
                stateCommitmentPreimage: proof.stateCommitmentPreimage,
                storageProof: proof.storageProofs[0]!.proof
            }
        });
    }
};
