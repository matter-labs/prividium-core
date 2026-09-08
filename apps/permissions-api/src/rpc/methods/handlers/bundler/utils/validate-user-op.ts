import type { Hex } from 'viem';
import { methodAccessSchema } from '../../../../../db/schema';
import type { UserOperation } from '../../../../../utils/schemas/user-operation';
import { type DispatchedCall, verifyAndParseDispatcher } from '../../../dispatchers';
import type { BundlerContext } from './is-bundler-context';

export type ValidationResult = { authorized: true } | { authorized: false; error: string };

const EMPTY_HEX = '0x';

function isEmptyHex(hex: Hex): boolean {
    return hex.toLowerCase() === EMPTY_HEX;
}

/**
 * Validates a UserOperation's callData against the sender's permissions.
 *
 * For ERC-4337, the sender field is the smart account address.
 * The sender address must be linked to the authenticated user's account,
 * and the user must have permissions for the contract interactions.
 *
 * This function uses strict parsing for SSO smart account calldata.
 * Any invalid or malformed calldata will result in rejection.
 *
 * Dispatcher verification (required):
 * - Verifies the sender's bytecode matches a known proxy pattern
 * - Verifies the proxy points to a whitelisted implementation
 * - If no dispatcher config is set, requests are rejected by default
 *
 * @returns ValidationResult indicating if the UserOp is authorized or the error reason
 */
export async function validateUserOpPermissions(
    context: BundlerContext,
    userOp: UserOperation,
    rpcMethod: string
): Promise<ValidationResult> {
    const { sender, callData, paymasterAndData, initCode } = userOp;

    // Verify sender is one of the user's associated wallets
    // This prevents attackers from probing private data by setting sender to arbitrary addresses
    const userAddresses = await context.authorizer.associatedAddresses();
    if (!userAddresses.has(sender)) {
        return { authorized: false, error: 'Sender address is not associated with the authenticated user' };
    }

    // Reject UserOps with paymaster (not yet supported)
    if (paymasterAndData && !isEmptyHex(paymasterAndData)) {
        return { authorized: false, error: 'Paymaster is not yet supported' };
    }

    // Reject UserOps with initCode/factory (not yet supported)
    if (initCode && !isEmptyHex(initCode)) {
        return { authorized: false, error: 'Account factory (initCode) is not yet supported' };
    }

    // Require dispatcher config - deny by default if not configured
    if (!context.dispatcherConfig) {
        return { authorized: false, error: 'Dispatcher verification not configured' };
    }

    // Extract and validate calls from callData
    // Verifies bytecode matches known proxy pattern and implementation is whitelisted
    const { result, calls: parsedCalls } = await verifyAndParseDispatcher(sender, callData, context.targetRpc, {
        ...context.dispatcherConfig,
        logger: context.logger
    });

    if (!result.valid) {
        return { authorized: false, error: result.error };
    }

    const calls: DispatchedCall[] = parsedCalls!;

    // Check if user has permission for each call
    for (const call of calls) {
        // Plain ETH transfers have no calldata — skip permission check.
        // execute() is always invoked on the sender's own account in ERC-4337,
        // and sender ownership is already verified above.
        if (isEmptyHex(call.data)) {
            continue;
        }

        const callAuth = await context.authorizer.checkContractAccess(
            sender,
            call.to,
            call.data,
            methodAccessSchema.enum.write,
            rpcMethod
        );
        if (!callAuth.authorized) {
            return { authorized: false, error: 'UserOp sender lacks permission for this operation' };
        }
    }

    return { authorized: true };
}
