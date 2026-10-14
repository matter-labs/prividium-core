import { type Address, size } from 'viem';
import type { z } from 'zod/v4';
import { WATCHDOG_GRANT, WATCHDOG_PUBLIC_CODE_ADDRESSES } from '../../permissions/watchdog-grant';
import { ForbiddenRpcError } from '../errors';
import type { AuthorizedRpcContext, MethodHandler } from '../rpc-service';
import { createBaseRpcMethodList } from './base-rpc-method-list';
import { decodeTx, eth_sendRawTransaction } from './handlers';

const sendToOwnWallets: typeof eth_sendRawTransaction = {
    ...eth_sendRawTransaction,
    async handle(context, method, params, id) {
        const { to, data } = await decodeTx(params[0]);
        if (to !== undefined && size(data) === 0 && !(await context.authorizer.checkAddressOwnership(to))) {
            throw new ForbiddenRpcError(
                undefined,
                'the watchdog sends value only to its own wallets',
                undefined,
                'watchdog.foreign_recipient'
            );
        }
        return eth_sendRawTransaction.handle(context, method, params, id);
    }
};

export function createWatchdogRpcMethodList(
    publicCodeAddresses: Address[]
): MethodHandler<AuthorizedRpcContext, z.ZodType>[] {
    const granted = new Set(WATCHDOG_GRANT.rpcMethods);
    return createBaseRpcMethodList([...publicCodeAddresses, ...WATCHDOG_PUBLIC_CODE_ADDRESSES], false)
        .filter((handler) => granted.has(handler.name))
        .map((handler) => (handler.name === eth_sendRawTransaction.name ? sendToOwnWallets : handler));
}
