import { type Address, getContractAddress, isAddressEqual } from 'viem';
import { z } from 'zod/v4';
import { addressSchema } from '../../../utils/schemas/address';
import { ForbiddenRpcError } from '../../errors';
import { type JSONLike, type JsonRpcResponse, response } from '../../json-rpc';
import type { Authorizer } from '../../permissions';
import type { AuthorizedRpcContext, MethodHandler } from '../../rpc-service';
import type { ExternalRpc } from '../../target-rpc';

const addressInFirstElementSchema = z.tuple([addressSchema], z.unknown());

const FOUNDRY_TEST_ADDRESS = '0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38';

// From: https://github.com/matter-labs/foundry-zksync/blob/53ed70f835b391a89bbeb7e70ac8a51a0a31c64d/crates/script/src/runner.rs#L143-L144
const FOUNDRY_ANTI_COLLISION_INDEX = 9223372036854775807n;

const PUBLIC_CODE_ADDRESSES: Address[] = [
    // Foundry's test address. Foundry always queries this address, is hardcoded at the beggining of the scripts
    FOUNDRY_TEST_ADDRESS,
    // Default create2 factory address. Foundry scripts always query this address.
    '0x4e59b44847b379578588920cA78FbF26c0B4956C',
    // Hardhat console address
    '0x000000000000000000636F6e736F6c652e6c6f67',
    // Addresses for the first 10 contracts deployed by foundry test address
    // We also add a special case used by foundry:
    ...[0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, FOUNDRY_ANTI_COLLISION_INDEX].map((nonce) =>
        getContractAddress({ from: FOUNDRY_TEST_ADDRESS, nonce })
    )
];

/**
 * Foundry calculates the contract address in advances and sends a request
 * in advance to verify the address is actually empty. We need to make
 * this request pass to make foundry scripts work.
 *
 * This doesn't leek information because users can see the bytecode/nonce/etc
 * of the contracts they deployed, and this contract addresses are associated to
 * addresses they own, so they have permission to see this.
 *
 * @param authorizer
 * @param targetRpc
 * @param targetAddress
 * @param id
 */
async function isNextContractAddressForCurrentUser(
    authorizer: Authorizer,
    targetRpc: ExternalRpc,
    targetAddress: Address,
    id: string | number
) {
    const allAddresses = await authorizer.associatedAddresses();
    return Promise.all(
        allAddresses.all().map(async (addr) => {
            const addrNonce = await targetRpc.nonceFor(addr, `${id}_getNonce_${addr}`);
            const futureContractAddress = getContractAddress({
                from: addr,
                nonce: addrNonce
            });
            return isAddressEqual(futureContractAddress, targetAddress);
        })
    ).then((res) => res.some((i) => i));
}

/**
 * This method handler is custom-made to make foundry scripts works preserving Prividium's privacy.
 * It's meant to be used with eth_getCode, eth_getBalance, and eth_getTransactionCount. Users
 *
 * This filter checks if the first argument of the call if an address of the user, a contract deployed
 * by the user, or one of a set of hand-picked addresses.
 *
 * Because these hand-picked addresses might be important system addresses, the handler provides
 * the option of defining constant hardcoded response values. For example, in `eth_getBalance` the real balance for those
 * addresses should not be revealed, but fail with a forbidden error breaks foundry scripts. Then, a constant
 * value can be used. But for `eth_getCode` we need to return the real code to make foundry able to execute.
 *
 * @param name
 * @param extraPublicCodeAddresses
 * @param whitelistedResult
 */
export function checkAddressOrContractOwnership(
    name: string,
    extraPublicCodeAddresses: Address[],
    whitelistedResult?: JSONLike
): MethodHandler<AuthorizedRpcContext, typeof addressInFirstElementSchema> {
    const publicCodeAddresses = [...extraPublicCodeAddresses, ...PUBLIC_CODE_ADDRESSES];
    return {
        name: name,
        paramsSchema: addressInFirstElementSchema,
        async handle(context, method, params, id): Promise<JsonRpcResponse> {
            const [targetAddress] = params;

            const isSpecialAddress = publicCodeAddresses.some((a) => isAddressEqual(a, targetAddress));

            if (isSpecialAddress) {
                if (whitelistedResult !== undefined) {
                    return response({ id, result: whitelistedResult });
                }
                return context.targetRpc.delegate(id, method, params);
            }

            const [addressBelongs, isContractDeployedByTheUser, orgVisible, isDeploymentForUserAddress] =
                await Promise.all([
                    context.authorizer.checkAddressOwnership(targetAddress),
                    context.authorizer.checkContractAuthorship(targetAddress),
                    context.authorizer.hasOrgVisibilityOver(targetAddress, true),
                    isNextContractAddressForCurrentUser(context.authorizer, context.targetRpc, targetAddress, id)
                ]);

            if (!addressBelongs && !isContractDeployedByTheUser && !orgVisible && !isDeploymentForUserAddress) {
                throw new ForbiddenRpcError(
                    undefined,
                    `${name} address check failed. Address ${targetAddress} does not belong to current user/tenant/service`
                );
            }

            return context.targetRpc.delegate(id, method, params);
        }
    };
}
