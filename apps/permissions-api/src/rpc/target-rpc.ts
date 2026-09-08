import { nanoid } from 'nanoid';
import { type Address, createPublicClient, type Hex, hexToNumber, http, type PublicClient } from 'viem';
import { type TypeOf, type ZodTypeAny, z } from 'zod/v4';
import type { BlockTag } from '../utils/schemas/block-tag';
import { hexSchema, hexSizedSchema } from '../utils/schemas/hex-schema';
import { SUBMISSION_CONFIRMS_INCLUSION, type TargetChainType } from '../utils/target-chain';
import { INTERNAL_RPC_ERROR, METHOD_NOT_FOUND_ERROR_CODE } from './constants';
import { WrongArguments } from './errors';
import { errorResponse, type JsonRpcRequest, type JsonRpcResponse, request, response } from './json-rpc';

const SUCCESS_RESPONSE_SCHEMA = z.object({
    jsonrpc: z.literal('2.0'),
    id: z.any(),
    result: z.any()
});

const ERROR_RESPONSE_SCHEMA = z.object({
    jsonrpc: z.literal('2.0'),
    id: z.any(),
    error: z.object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional()
    })
});

const RESPONSE_SCHEMA = z.union([ERROR_RESPONSE_SCHEMA, SUCCESS_RESPONSE_SCHEMA]);

/**
 * Thrown by `TargetRpc.send()` when the upstream RPC returns a JSON-RPC error envelope.
 * Lets callers branch on `code` instead of pattern-matching messages.
 */
export class TargetRpcCallError extends Error {
    code: number;
    method: string;
    data: unknown;
    responseMessage: string;
    constructor(method: string, code: number, message: string, data?: unknown) {
        super(`error on target rpc calling "${method}": ${message}`);
        this.method = method;
        this.code = code;
        this.data = data;
        this.responseMessage = message;
    }
}

const nonExistenceProofSchema = z.object({
    type: z.literal('nonExisting'),
    leftNeighbor: z.object({
        index: z.int(),
        value: hexSchema,
        nextIndex: z.int(),
        siblings: hexSchema.array(),
        leafKey: hexSchema
    }),
    rightNeighbor: z.object({
        index: z.int(),
        value: hexSchema,
        nextIndex: z.int(),
        siblings: hexSchema.array(),
        leafKey: hexSchema
    })
});
const existenceProofSchema = z.object({
    type: z.literal('existing'),
    index: z.int(),
    value: hexSchema,
    nextIndex: z.int(),
    siblings: hexSchema.array()
});

const proofSchema = z.union([existenceProofSchema, nonExistenceProofSchema]);

const zksGetProofSchema = z.object({
    address: hexSchema,
    stateCommitmentPreimage: z.object({
        nextFreeSlot: hexSchema,
        blockNumber: hexSchema,
        last256BlockHashesBlake: hexSchema,
        lastBlockTimestamp: hexSchema
    }),
    storageProofs: z.array(
        z.object({
            key: hexSchema,
            proof: proofSchema
        })
    ),
    l1VerificationData: z.object({
        batchNumber: z.number(),
        numberOfLayer1Txs: z.number(),
        priorityOperationsHash: hexSchema,
        dependencyRootsRollingHash: hexSchema,
        l2ToL1LogsRootHash: hexSchema,
        commitment: hexSchema
    })
});

export type ZksGetProofResponse = z.infer<typeof zksGetProofSchema>;

/**
 * Minimal shape we extract from the sync receipt: just the tx hash. Wider
 * receipt fields are ignored so the schema stays decoupled from upstream
 * receipt evolution. Hash is required to be exactly 32 bytes so we don't
 * silently propagate a malformed receipt to the caller as a "successful"
 * tx hash.
 */
const syncReceiptSchema = z.object({
    transactionHash: hexSizedSchema(32)
});

const UNIMPLEMENTED_MESSAGE_RE = /unimplemented|not implemented|unsupported/i;

/**
 * Rewrites upstream `-32603 unimplemented`-class errors to canonical
 * `-32601 Method not found`.
 */
export function normalizeUpstreamResponse(upstream: JsonRpcResponse): JsonRpcResponse {
    if (
        'error' in upstream &&
        upstream.error.code === INTERNAL_RPC_ERROR &&
        typeof upstream.error.message === 'string' &&
        UNIMPLEMENTED_MESSAGE_RE.test(upstream.error.message)
    ) {
        return errorResponse({
            id: upstream.id,
            error: { code: METHOD_NOT_FOUND_ERROR_CODE, message: 'Method not found' }
        });
    }
    return upstream;
}

/**
 * Shared reshape used by both `TargetRpc` and the test double: takes the
 * raw upstream response from `eth_sendRawTransactionSync` and produces an
 * `eth_sendRawTransaction`-shaped response (tx hash on success, error
 * pass-through, internal error on malformed receipt).
 */
export function reshapeSendRawSync(id: JsonRpcRequest['id'], upstream: JsonRpcResponse): JsonRpcResponse {
    if ('error' in upstream) {
        return upstream;
    }
    const receipt = syncReceiptSchema.safeParse(upstream.result);
    if (!receipt.success) {
        return errorResponse({
            id,
            error: {
                code: INTERNAL_RPC_ERROR,
                message: 'eth_sendRawTransactionSync did not return a valid receipt'
            }
        });
    }
    return response({ id, result: receipt.data.transactionHash });
}

/** Single submission branch shared by `TargetRpc` and the test double. */
export async function submitRawTransactionUpstream(
    rpc: Pick<ExternalRpc, 'chainType' | 'delegate'>,
    id: JsonRpcRequest['id'],
    rawTx: Hex
): Promise<JsonRpcResponse> {
    if (!SUBMISSION_CONFIRMS_INCLUSION[rpc.chainType]) {
        return rpc.delegate(id, 'eth_sendRawTransaction', [rawTx]);
    }
    const upstream = await rpc.delegate(id, 'eth_sendRawTransactionSync', [rawTx]);
    return reshapeSendRawSync(id, upstream);
}

export interface ExternalRpc {
    readonly chainType: TargetChainType;
    delegate(
        id: JsonRpcRequest['id'],
        method: JsonRpcRequest['method'],
        params: JsonRpcRequest['params']
    ): Promise<JsonRpcResponse>;
    /**
     * On zksync-os submits via `eth_sendRawTransactionSync` (reshaped to a
     * hash) so the chain's second admit/judge pass surfaces as an error
     * instead of a forever-pending hash; success means mined. On besu submits
     * via plain `eth_sendRawTransaction`; success means in-mempool.
     */
    submitRawTransaction(id: JsonRpcRequest['id'], rawTx: Hex): Promise<JsonRpcResponse>;
    /**
     * The `contractAddress` of a deploy tx's receipt, or null when the tx is
     * unmined, reverted, or not a deploy. Used by authorship reconciliation.
     */
    deployReceiptContractAddress(id: string, txHash: Hex): Promise<Address | null>;
    /** True while the chain still knows the tx (in the mempool or mined). */
    transactionIsKnown(id: string, txHash: Hex): Promise<boolean>;
    send<T extends ZodTypeAny>(id: number | string, method: string, params: unknown[], schema: T): Promise<TypeOf<T>>;

    getBalanceFor(id: string, address: Address, block?: BlockTag): Promise<Hex>;

    getCodeFor(id: string, address: Address, block?: BlockTag): Promise<Hex>;

    isContract(address: Address, id?: string): Promise<boolean>;

    nonceFor(address: Address, id?: string, block?: BlockTag): Promise<bigint>;

    /** The node's `eth_chainId`, decoded to a number. */
    chainId(id?: string): Promise<number>;

    viemPublicClient(): PublicClient;

    debugCall<T extends ZodTypeAny>(
        id: string | number,
        from: Hex,
        to: Hex,
        callData: Hex,
        blockNumber: BlockTag,
        tracerStr: string,
        responseSchema: T
    ): Promise<TypeOf<T>>;

    batchForBlock(id: string, block: BlockTag | Hex): Promise<{ batchNumber: number; blockNumber: Hex }>;

    getProf(id: string, address: Hex, slotList: Hex[], batchNumber: number): Promise<ZksGetProofResponse>;
}

export class TargetRpc implements ExternalRpc {
    private url: string;
    readonly chainType: TargetChainType;

    constructor(url: string, chainType: TargetChainType) {
        this.url = url;
        this.chainType = chainType;
    }

    async delegate(
        id: JsonRpcRequest['id'],
        method: JsonRpcRequest['method'],
        params: JsonRpcRequest['params']
    ): Promise<JsonRpcResponse> {
        const res = await this.rawDelegate(JSON.stringify(request({ id, method, params })));

        // you can't just use response.body, which would be much faster
        // because the framework doesn't handle it nicely in case of batch requests
        // TODO research if that can be improved
        const parsed = (await res.json()) as JsonRpcResponse;
        return normalizeUpstreamResponse(parsed);
    }

    async rawDelegate(body: string | Uint8Array): ReturnType<typeof fetch> {
        return await fetch(this.url, {
            method: 'POST',
            body: body,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    async submitRawTransaction(id: JsonRpcRequest['id'], rawTx: Hex): Promise<JsonRpcResponse> {
        return submitRawTransactionUpstream(this, id, rawTx);
    }

    async deployReceiptContractAddress(id: string, txHash: Hex): Promise<Address | null> {
        const receipt = await this.send(
            id,
            'eth_getTransactionReceipt',
            [txHash],
            z.object({ contractAddress: hexSchema.nullable().optional(), status: hexSchema.optional() }).nullable()
        );
        // A reverted CREATE still carries contractAddress; it deployed nothing.
        if (!receipt || receipt.status === '0x0') {
            return null;
        }
        return (receipt.contractAddress as Address | null | undefined) ?? null;
    }

    async transactionIsKnown(id: string, txHash: Hex): Promise<boolean> {
        const tx = await this.send(id, 'eth_getTransactionByHash', [txHash], z.object({ hash: hexSchema }).nullable());
        return tx !== null;
    }

    async send<T extends ZodTypeAny>(
        id: number | string,
        method: string,
        params: unknown[],
        schema: T
    ): Promise<TypeOf<T>> {
        const response = await fetch(this.url, {
            method: 'POST',
            body: JSON.stringify(request({ id, method, params })),
            headers: { 'Content-Type': 'application/json' }
        }).catch((err: unknown) => {
            throw new Error(`error calling target rpc: "${method}"`, {
                cause: { method, params, rpcReqId: id, err }
            });
        });

        const json = await response.json().catch(() => {
            throw new Error(`error calling target rpc: "${method}". Response was not a valid json.`, {
                cause: { method, params, rpcReqId: id, errMsg: 'invalid json response' }
            });
        });

        const jsonRpcEnvelope = RESPONSE_SCHEMA.safeParse(json);

        if (!jsonRpcEnvelope.success) {
            throw new Error(`error on target rpc calling "${method}". Target rpc did not return a valid json.`, {
                cause: { method, params, rpcReqId: id, message: z.flattenError(jsonRpcEnvelope.error) }
            });
        }

        if ('error' in jsonRpcEnvelope.data) {
            const { code, message, data } = jsonRpcEnvelope.data.error;
            throw new TargetRpcCallError(method, code, message, data);
        }

        const responseContent = schema.safeParse(jsonRpcEnvelope.data.result);

        if (!responseContent.success) {
            throw new Error(`error on target rpc calling "${method}". Target rpc did not return a valid response.`, {
                cause: { method, params, rpcReqId: id, message: z.flattenError(responseContent.error) }
            });
        }

        return responseContent.data;
    }

    async getBalanceFor(id: string, address: Address, block: BlockTag = 'latest'): Promise<Hex> {
        return this.send(id, 'eth_getBalance', [address, block], hexSchema);
    }

    async getCodeFor(id: string, address: Address, block: BlockTag = 'latest'): Promise<Hex> {
        return this.send(id, 'eth_getCode', [address, block], hexSchema);
    }

    viemPublicClient(): PublicClient {
        return createPublicClient({ transport: http(this.url) });
    }

    async isContract(address: Address, id?: string): Promise<boolean> {
        const code = await this.getCodeFor(id ?? nanoid(), address);
        return code !== '0x';
    }

    async nonceFor(address: Address, id?: string, block: BlockTag = 'latest'): Promise<bigint> {
        const hexNonce = await this.send(id ?? nanoid(), 'eth_getTransactionCount', [address, block], hexSchema);
        if (hexNonce === '0x') {
            return 0n;
        }
        return BigInt(hexNonce);
    }

    async chainId(id?: string): Promise<number> {
        return hexToNumber(await this.send(id ?? nanoid(), 'eth_chainId', [], hexSchema));
    }

    async debugCall<T extends ZodTypeAny>(
        id: string | number,
        from: Hex,
        to: Hex,
        callData: Hex,
        blockNumber: BlockTag,
        tracerStr: string,
        responseSchema: T
    ): Promise<TypeOf<T>> {
        return this.send(
            id,
            'debug_traceCall',
            [
                {
                    from,
                    to,
                    data: callData
                },
                blockNumber,
                { tracer: tracerStr }
            ],
            responseSchema
        );
    }

    async batchForBlock(id: string, block: BlockTag | Hex): Promise<{ batchNumber: number; blockNumber: Hex }> {
        const blockNumber = await this.resolveBlock(`${id}_resolve`, block);
        try {
            const batchInfo = await this.send(
                id,
                'unstable_getBatchByBlockNumber',
                [hexToNumber(blockNumber)],
                z.object({
                    batch_info: z.object({
                        batch_number: z.number()
                    })
                })
            );

            return { batchNumber: batchInfo.batch_info.batch_number, blockNumber };
        } catch (err) {
            if (err instanceof TargetRpcCallError) {
                throw new WrongArguments(`Block ${blockNumber} has not been included in a batch yet`);
            }
            throw err;
        }
    }

    private async resolveBlock(id: string, block: BlockTag | Hex): Promise<Hex> {
        if (block.startsWith('0x')) {
            return block as Hex;
        }

        const result = await this.send(
            id,
            'eth_getBlockByNumber',
            [block, false],
            z.object({ number: hexSchema.nullable() })
        );

        if (result.number === null) {
            throw new WrongArguments(`block tag "${block}" did not resolve to a concrete block`);
        }

        return result.number;
    }

    async getProf(id: string, address: Hex, slotList: Hex[], batchNumber: number): Promise<ZksGetProofResponse> {
        return this.send(id, 'zks_getProof', [address, slotList, batchNumber], zksGetProofSchema);
    }
}
