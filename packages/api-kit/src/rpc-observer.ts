import type { Address, Hex } from 'viem';
import { z } from 'zod/v4';

/**
 * What the core tells a feature about its RPC traffic, implemented only by a
 * feature. Every call must swallow its own failures: observing never changes
 * an RPC response.
 */

/** The core's two RPC surfaces. */
export type RpcOrigin = 'rpc' | 'rpc_wallet';

export const RPC_ACTOR_TYPES = ['user', 'tenant', 'm2m_app', 'anonymous'] as const;
export const rpcActorTypeSchema = z.enum(RPC_ACTOR_TYPES);
export type RpcActorType = z.infer<typeof rpcActorTypeSchema>;

/** Who is calling, resolved once per request before any method runs. */
export type RpcActorContext = {
    origin: RpcOrigin;
    actorType: RpcActorType;
    actorId: string | null;
    organizationId: string | null;
    ip: string | null;
    requestId: string | null;
    traceId: string | null;
};

export type RpcDenial = {
    method: string;
    params: unknown[];
    error: { message: string; reason: string; ruleId?: string };
};

/** Per request: the `record*` calls buffer, `flush` runs once after the response is built. */
export interface RpcObserver {
    recordDenial(denial: RpcDenial): void;
    recordSubmission(rawTx: Hex): void;
    recordRejection(rawTx: Hex, code: number): void;
    recordThrottled(rawTx: Hex, code: number): void;
    flush(): Promise<void>;
}

/** `undefined` observes nothing for that request. */
export type RpcObserverFactory = (actor: RpcActorContext) => RpcObserver | undefined;

/** A refused `/admit` check, the top-level transaction-admission decision. */
export type AdmitDenial = {
    senderAddress: Address;
    targetAddress: Address | null;
    reason: string | null;
    ruleId: string | null;
    requestId: string | null;
};

export type AdmitDeniedHook = (denial: AdmitDenial) => Promise<void>;
