import {
    type Account,
    type Chain,
    type ClientConfig,
    createClient,
    type PublicActions,
    type PublicClient,
    type PublicClientConfig,
    publicActions,
    type RpcSchema,
    type Transport
} from 'viem';
import { type SelectiveDisclosureActions, selectiveDisclosureActions } from './selective-disclosure/index.js';

type PrividiumClientConfig<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined,
    accountOrAddress extends Account | undefined = undefined,
    rpcSchema extends RpcSchema | undefined = undefined
> = PublicClientConfig<transport, chain, accountOrAddress, rpcSchema> &
    Pick<ClientConfig<transport, chain, accountOrAddress, rpcSchema>, 'account'>;

function prividiumActions<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined,
    accountOrAddress extends Account | undefined = undefined,
    rpcSchema extends RpcSchema | undefined = undefined
>(
    client: PublicClient<transport, chain, accountOrAddress, rpcSchema>
): Pick<PublicActions<transport, chain, accountOrAddress>, 'call'> {
    return {
        call: (args) => {
            if (!client.account?.address) {
                throw new Error('RPC method eth_call requires an account to be provided for the client');
            }
            return client.call(args);
        }
    };
}

/**
 * Creates a Prividium specific Public Client. This client extends the standard Viem Public Client
 * with additional checks required for Prividium operations.
 */
export function createPrividiumClient<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined,
    accountOrAddress extends Account | undefined = undefined,
    rpcSchema extends RpcSchema | undefined = undefined
>(
    config: PrividiumClientConfig<transport, chain, accountOrAddress, rpcSchema>
): PublicClient<transport, chain, accountOrAddress, rpcSchema> & SelectiveDisclosureActions {
    const { key = 'prividium', name = 'Prividium™ Public Client' } = config;
    const client = createClient({
        ...config,
        key,
        name,
        type: 'publicClient'
    }) as unknown as PublicClient<transport, chain, accountOrAddress, rpcSchema>;

    return client.extend(publicActions).extend(prividiumActions).extend(selectiveDisclosureActions);
}
