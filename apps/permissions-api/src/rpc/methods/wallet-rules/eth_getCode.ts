import { type JsonRpcResponse, response } from '../../json-rpc';
import { type AnyParams, anyParams } from '../../params-schemas';
import type { MethodHandler, WalletContext } from '../../rpc-service';

// Handler for getCode that returns empty code for allowance address (EOA) and dummy code for others
export const eth_getCode: MethodHandler<WalletContext, AnyParams> = {
    name: 'eth_getCode',
    paramsSchema: anyParams,
    handle(_context, _method, _params, id): Promise<JsonRpcResponse> {
        // Return dummy code for all addresses
        return Promise.resolve(
            response({
                id,
                result: '0x60606040'
            })
        );
    }
};
