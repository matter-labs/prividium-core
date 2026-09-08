import { RpcException } from './errors';
import { TargetRpcCallError } from './target-rpc';

/** Node error envelope exposed only by filtered reads that cannot leak unfiltered data. */
export class FilteredReadRpcError extends RpcException {
    constructor(error: TargetRpcCallError) {
        super(error.responseMessage, error.code, undefined, error.data);
        this.cause = error;
    }
}

/** Preserves node errors for filtered-read handlers while leaving other failures masked. */
export async function forwardFilteredReadNodeError<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (error) {
        if (error instanceof TargetRpcCallError) {
            throw new FilteredReadRpcError(error);
        }
        throw error;
    }
}
