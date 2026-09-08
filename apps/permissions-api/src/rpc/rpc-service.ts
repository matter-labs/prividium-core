import type { RpcObserver } from '@repo/api-kit';
import type { Address, PublicClient } from 'viem';
import { z } from 'zod/v4';
import type { ContractDeployment, CreateContractDeployment } from '../repositories/contract-deployments-repository';
import type { PinoLogger } from '../utils/logger';
import { INTERNAL_RPC_ERROR } from './constants';
import type { DeploymentContext } from './contract-deployment-context';
import { ForbiddenRpcError, InvalidRpcRequest, RpcException, WrongArguments } from './errors';
import { FilteredReadRpcError } from './filtered-read-error';
import { errorResponse, type JsonRpcResponse, MAX_RPC_BATCH_SIZE } from './json-rpc';
import { createBaseRpcMethodList } from './methods/base-rpc-method-list';
import type { DispatcherConfig } from './methods/dispatchers';
import { methodNotFound } from './methods/generic-handlers';
import { requireFullSequencerAccess } from './methods/generic-handlers/require-full-sequencer-access';
import { bundlerHandlers } from './methods/handlers/bundler';
import { fullSequencerAccessBroadcastTx } from './methods/handlers/full-sequencer-access-broadcast-tx';
import { fullSequencerAccessEthCall } from './methods/handlers/full-sequencer-access-eth-call';
import { prividium_accountDataDisclosure } from './methods/handlers/prividium_accountDataDisclosure';
import { prividium_tokenBalanceDisclosure } from './methods/handlers/prividium_tokenBalanceDisclosure';
import { prividium_tokenSupplyDisclosure } from './methods/handlers/prividium_tokenSupplyDisclosure';
import type { Authorizer, WalletAuthorizer } from './permissions';
import type { ServiceAuthorizer } from './permissions/service-authorizer';
import type { ExternalRpc } from './target-rpc';

export const rpcReqSchema = z.object({
    id: z.union([z.number(), z.string()]),
    jsonrpc: z.literal('2.0'),
    method: z.string(),
    params: z.array(z.any()).optional().default([])
});

export type DeploymentHooks = {
    onDeployStart: (data: CreateContractDeployment) => Promise<ContractDeployment>;
    onDeploySuccess: (id: ContractDeployment['id']) => Promise<void>;
    onDeployError: (id: ContractDeployment['id'], msg: string) => Promise<void>;
};

export type BaseContext = {
    targetRpc: ExternalRpc;
    bundlerRpc: ExternalRpc | null;
    dispatcherConfig?: DispatcherConfig;
    logger: PinoLogger;
    deployment: null | DeploymentContext;
    /** A feature's per-request observer; absent when no feature asked to watch this request. */
    rpcObserver?: RpcObserver;
};

export type AuthorizedRpcContext = BaseContext & {
    authorizer: Authorizer;
    /** Whether the policy listener (`/admit` + `/judge`) is mounted on the
     * server. Read by full-sequencer-access eth_call to decide whether to
     * rewrite to debug_traceCall (the validator is active and would otherwise
     * reject the simulated `from`) or forward as-is. */
    policyEnabled: boolean;
};

export type BundlerRpcContext = AuthorizedRpcContext & {
    bundlerRpc: ExternalRpc;
    /** Optional dispatcher config for smart account verification */
    dispatcherConfig?: DispatcherConfig;
    /** RPC client for dispatcher verification (reading bytecode/storage) */
    rpcClient: PublicClient;
};

export type WalletContext = BaseContext & {
    walletAuthorizer: WalletAuthorizer;
};

export type ServiceContext = BaseContext & {
    serviceAuthorizer: ServiceAuthorizer;
};

export interface MethodHandler<Ctx, TSchema extends z.ZodType> {
    name: string;
    paramsSchema: TSchema;
    handle(context: Ctx, method: string, params: z.infer<TSchema>, id: number | string): Promise<JsonRpcResponse>;
}

export class RpcCallHandler<Ctx extends BaseContext> {
    private handlers: Record<string, MethodHandler<Ctx, z.ZodType>>;
    private defaultHandler: MethodHandler<Ctx, z.ZodType>;
    private context: Ctx;

    constructor(
        handlers: MethodHandler<Ctx, z.ZodType>[],
        context: Ctx,
        defaultHandler: MethodHandler<Ctx, z.ZodType> = methodNotFound('unknown')
    ) {
        this.context = context;
        this.handlers = handlers.reduce<Record<string, MethodHandler<Ctx, z.ZodType>>>((acum, current) => {
            acum[current.name] = current;
            return acum;
        }, {});
        this.defaultHandler = defaultHandler;
    }

    async handle(rawBody: unknown): Promise<JsonRpcResponse | JsonRpcResponse[]> {
        // Batch request: array of requests
        if (Array.isArray(rawBody)) {
            if (rawBody.length === 0) {
                throw new InvalidRpcRequest();
            }
            if (rawBody.length > MAX_RPC_BATCH_SIZE) {
                throw new InvalidRpcRequest(`Batch too large: at most ${MAX_RPC_BATCH_SIZE} requests per batch`);
            }
            const responses = await Promise.all(rawBody.map(async (item) => this.handleSingleRequest(item)));
            await this.context.rpcObserver?.flush();
            return responses;
        }

        // Single request
        const response = await this.handleSingleRequest(rawBody);
        await this.context.rpcObserver?.flush();
        return response;
    }

    private async handleSingleRequest(request: unknown): Promise<JsonRpcResponse> {
        const parsed = rpcReqSchema.safeParse(request);
        this.context.logger.info({
            message: `rpc call started`,
            rpcReqId: parsed.data?.id,
            method: parsed.data?.method
        });

        if (parsed.error) {
            this.context.logger.debug(parsed.error, 'invalid request');
            throw new InvalidRpcRequest();
        }

        const { method, params, id } = parsed.data;
        try {
            return await this.tryCall(method, params, id);
        } catch (e) {
            if (e instanceof RpcException) {
                if (e instanceof ForbiddenRpcError) {
                    // permission denial; the caller must pre-bind actor + correlation context on this logger
                    this.context.logger.warn(
                        {
                            event: 'rpc.permission_denied',
                            method,
                            rpcReqId: id,
                            denialMessage: e.message,
                            reason: e.reason
                        },
                        'RPC permission denied'
                    );
                    if (this.context.rpcObserver) {
                        this.context.rpcObserver.recordDenial({ method, params, error: e });
                    }
                } else if (e instanceof FilteredReadRpcError) {
                    this.context.logger.error({
                        err: e.cause,
                        message: 'Target RPC error in filtered read handler',
                        id,
                        params,
                        method
                    });
                } else {
                    this.context.logger.debug(e);
                }
                return errorResponse({
                    id: parsed.data.id,
                    error: {
                        message: e.message,
                        code: e.code,
                        data: e.data
                    }
                });
            }

            this.context.logger.error({
                err: e,
                message: 'Error in handler',
                id: parsed.data?.id,
                params: parsed.data?.params,
                method: parsed.data?.method,
                cause: e instanceof Error ? e.cause : undefined
            });
            return errorResponse({
                id: parsed.data.id,
                error: {
                    code: INTERNAL_RPC_ERROR,
                    message: 'Internal error'
                }
            });
        } finally {
            this.context.logger.info({
                message: 'rpc call finished',
                rpcReqId: parsed.data?.id,
                method: parsed.data?.method
            });
        }
    }

    private async tryCall(method: string, params: unknown[] = [], id: number | string) {
        const handler = this.handlers[method] ?? this.defaultHandler;

        const validated = handler.paramsSchema.safeParse(params);
        if (!validated.success) {
            throw new WrongArguments();
        }

        return handler.handle(this.context, method, validated.data, id);
    }

    static forFullAccess(
        context: AuthorizedRpcContext,
        disclosureMethodsEnabled: boolean = false
    ): RpcCallHandler<AuthorizedRpcContext> {
        const bundlerMethods = bundlerHandlers.map(({ name }) => requireFullSequencerAccess(name, 'bundlerRpc'));
        const disclosureMethods = disclosureMethodsEnabled
            ? [prividium_accountDataDisclosure, prividium_tokenSupplyDisclosure, prividium_tokenBalanceDisclosure]
            : [];
        return new RpcCallHandler(
            [fullSequencerAccessBroadcastTx, fullSequencerAccessEthCall, ...bundlerMethods, ...disclosureMethods],
            context,
            requireFullSequencerAccess('default')
        );
    }

    static forRegularAccess(
        context: AuthorizedRpcContext,
        publicCodeAddresses: Address[],
        disclosureMethodsEnabled: boolean
    ): RpcCallHandler<AuthorizedRpcContext> {
        return new RpcCallHandler(createBaseRpcMethodList(publicCodeAddresses, disclosureMethodsEnabled), context);
    }
}
