import type { RpcObserver } from '@repo/api-kit';
import { describe, expect, it, vi } from 'vitest';
import { EIP_7966_TIMEOUT_CODE, INTERNAL_RPC_ERROR, SEQUENCER_RATE_LIMIT_ERROR_CODE } from './constants';
import type { JsonRpcResponse } from './json-rpc';
import { forwardAndRecordSubmission } from './rpc-observer';
import type { ExternalRpc } from './target-rpc';

const RAW_TX = '0xdeadbeef' as const;

function contextWith(response: JsonRpcResponse) {
    const recordSubmission = vi.fn(async () => {});
    const recordRejection = vi.fn(async () => {});
    const recordThrottled = vi.fn(async () => {});
    const targetRpc = { submitRawTransaction: vi.fn(async () => response) } as unknown as ExternalRpc;
    const rpcObserver: RpcObserver = {
        recordDenial: vi.fn(),
        recordSubmission,
        recordRejection,
        recordThrottled,
        flush: vi.fn(async () => {})
    };
    return { targetRpc, rpcObserver, recordSubmission, recordRejection, recordThrottled };
}

describe('forwardAndRecordSubmission', () => {
    const rejectionCodes = [-32000, -32003, INTERNAL_RPC_ERROR];

    it('records a receipt when the upstream accepts the tx', async () => {
        const { targetRpc, rpcObserver, recordSubmission } = contextWith({
            jsonrpc: '2.0',
            id: 1,
            result: '0xhash'
        });
        await forwardAndRecordSubmission({ targetRpc, rpcObserver }, 1, RAW_TX);
        expect(recordSubmission).toHaveBeenCalledWith(RAW_TX);
    });

    it('treats an EIP-7966 timeout as accepted and records a receipt', async () => {
        const { targetRpc, rpcObserver, recordSubmission } = contextWith({
            jsonrpc: '2.0',
            id: 1,
            error: { code: EIP_7966_TIMEOUT_CODE, message: 'timeout' }
        });
        await forwardAndRecordSubmission({ targetRpc, rpcObserver }, 1, RAW_TX);
        expect(recordSubmission).toHaveBeenCalledWith(RAW_TX);
    });

    it.each(rejectionCodes)('records a rejection with the upstream error code %i', async (code) => {
        const { targetRpc, rpcObserver, recordSubmission, recordRejection } = contextWith({
            jsonrpc: '2.0',
            id: 1,
            error: { code, message: 'boom' }
        });
        await forwardAndRecordSubmission({ targetRpc, rpcObserver }, 1, RAW_TX);
        expect(recordSubmission).not.toHaveBeenCalled();
        expect(recordRejection).toHaveBeenCalledWith(RAW_TX, code);
    });

    it('records a rate limit as throttled, not as a rejection', async () => {
        const { targetRpc, rpcObserver, recordSubmission, recordRejection, recordThrottled } = contextWith({
            jsonrpc: '2.0',
            id: 1,
            error: { code: SEQUENCER_RATE_LIMIT_ERROR_CODE, message: 'bank exhausted', data: { retryAfterMs: 1200 } }
        });
        await forwardAndRecordSubmission({ targetRpc, rpcObserver }, 1, RAW_TX);
        expect(recordThrottled).toHaveBeenCalledWith(RAW_TX, SEQUENCER_RATE_LIMIT_ERROR_CODE);
        expect(recordRejection).not.toHaveBeenCalled();
        expect(recordSubmission).not.toHaveBeenCalled();
    });

    it('passes the rate-limit retry hint through to the caller', async () => {
        const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 1,
            error: { code: SEQUENCER_RATE_LIMIT_ERROR_CODE, message: 'bank exhausted', data: { retryAfterMs: 1200 } }
        };
        const { targetRpc, rpcObserver } = contextWith(response);
        expect(await forwardAndRecordSubmission({ targetRpc, rpcObserver }, 1, RAW_TX)).toEqual(response);
    });

    it('returns the upstream response unchanged when no recorder is present', async () => {
        const response: JsonRpcResponse = { jsonrpc: '2.0', id: 1, result: '0xhash' };
        const targetRpc = { submitRawTransaction: vi.fn(async () => response) } as unknown as ExternalRpc;
        expect(await forwardAndRecordSubmission({ targetRpc, rpcObserver: undefined }, 1, RAW_TX)).toBe(response);
    });
});
