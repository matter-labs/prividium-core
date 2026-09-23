import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { upstreamRpcDuration } from '../utils/metrics';
import { BAD_RPC_PARAMS_ERROR_CODE, INTERNAL_RPC_ERROR, METHOD_NOT_FOUND_ERROR_CODE } from './constants';
import { RpcException } from './errors';
import type { JsonRpcResponse } from './json-rpc';
import { normalizeUpstreamResponse, reshapeSendRawSync, TargetRpc, TargetRpcCallError } from './target-rpc';

const TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

describe('reshapeSendRawSync', () => {
    it('extracts transactionHash from a successful receipt response', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 1,
            result: {
                transactionHash: TX_HASH,
                blockHash: '0xdeadbeef',
                blockNumber: '0x10',
                status: '0x1'
            }
        };

        const reshaped = reshapeSendRawSync(1, upstream);

        expect(reshaped).toEqual({ jsonrpc: '2.0', id: 1, result: TX_HASH });
    });

    it('passes upstream error envelopes through unchanged', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 'abc',
            error: { code: -32003, message: 'transaction rejected during execution' }
        };

        const reshaped = reshapeSendRawSync('abc', upstream);

        expect(reshaped).toBe(upstream);
    });

    it('passes EIP-7966 timeout (code 4) through unchanged', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 7,
            error: { code: 4, message: 'transaction not mined within timeout' }
        };

        const reshaped = reshapeSendRawSync(7, upstream);

        expect(reshaped).toBe(upstream);
    });

    it('returns an internal error when the receipt has no transactionHash', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 1,
            result: { blockHash: '0xdeadbeef' }
        };

        const reshaped = reshapeSendRawSync(1, upstream);

        expect(reshaped).toMatchObject({
            jsonrpc: '2.0',
            id: 1,
            error: { code: INTERNAL_RPC_ERROR }
        });
    });

    it('returns an internal error when transactionHash is not 0x-hex', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 1,
            result: { transactionHash: 'not-a-hash' }
        };

        const reshaped = reshapeSendRawSync(1, upstream);

        expect(reshaped).toMatchObject({
            jsonrpc: '2.0',
            id: 1,
            error: { code: INTERNAL_RPC_ERROR }
        });
    });

    it('returns an internal error when transactionHash is shorter than 32 bytes', () => {
        // Without a sized check a short-but-valid hex like `0x1234` would pass
        // and propagate as a "successful" tx hash to the caller.
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 1,
            result: { transactionHash: '0x1234' }
        };

        const reshaped = reshapeSendRawSync(1, upstream);

        expect(reshaped).toMatchObject({
            jsonrpc: '2.0',
            id: 1,
            error: { code: INTERNAL_RPC_ERROR }
        });
    });

    it('returns an internal error when transactionHash is empty (0x)', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 1,
            result: { transactionHash: '0x' }
        };

        const reshaped = reshapeSendRawSync(1, upstream);

        expect(reshaped).toMatchObject({
            jsonrpc: '2.0',
            id: 1,
            error: { code: INTERNAL_RPC_ERROR }
        });
    });

    it('returns an internal error when the result is null', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 1,
            result: null
        };

        const reshaped = reshapeSendRawSync(1, upstream);

        expect(reshaped).toMatchObject({
            jsonrpc: '2.0',
            id: 1,
            error: { code: INTERNAL_RPC_ERROR }
        });
    });
});

describe('normalizeUpstreamResponse', () => {
    it('rewrites -32603 "unimplemented" to -32601 Method not found', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 1,
            error: { code: INTERNAL_RPC_ERROR, message: 'unimplemented' }
        };

        const normalized = normalizeUpstreamResponse(upstream);

        expect(normalized).toEqual({
            jsonrpc: '2.0',
            id: 1,
            error: { code: METHOD_NOT_FOUND_ERROR_CODE, message: 'Method not found' }
        });
    });

    it('passes -32603 with unrelated message through unchanged', () => {
        const upstream: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: 4,
            error: { code: INTERNAL_RPC_ERROR, message: 'out of gas' }
        };

        const normalized = normalizeUpstreamResponse(upstream);

        expect(normalized).toBe(upstream);
    });
});

describe('TargetRpc.submitRawTransaction', () => {
    const RAW_TX = '0xdeadbeef' as const;

    it('on zksync-os delegates eth_sendRawTransactionSync and returns the receipt hash', async () => {
        const rpc = new TargetRpc('http://unused', 'zksync-os');
        const delegate = vi
            .spyOn(rpc, 'delegate')
            .mockResolvedValue({ jsonrpc: '2.0', id: 1, result: { transactionHash: TX_HASH } });

        await expect(rpc.submitRawTransaction(1, RAW_TX)).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: TX_HASH });
        expect(delegate).toHaveBeenCalledWith(1, 'eth_sendRawTransactionSync', [RAW_TX]);
    });

    it('on besu delegates eth_sendRawTransaction', async () => {
        const rpc = new TargetRpc('http://unused', 'besu');
        const delegate = vi.spyOn(rpc, 'delegate').mockResolvedValue({ jsonrpc: '2.0', id: 1, result: TX_HASH });

        await rpc.submitRawTransaction(1, RAW_TX);
        expect(delegate).toHaveBeenCalledWith(1, 'eth_sendRawTransaction', [RAW_TX]);
    });

    it('on besu passes a plain hash through without reshaping', async () => {
        const rpc = new TargetRpc('http://unused', 'besu');
        vi.spyOn(rpc, 'delegate').mockResolvedValue({ jsonrpc: '2.0', id: 1, result: TX_HASH });

        await expect(rpc.submitRawTransaction(1, RAW_TX)).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: TX_HASH });
    });
});

describe('TargetRpc.deployReceiptContractAddress', () => {
    const DEPLOYED_AT = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

    it('returns the contract address of a successful deploy receipt', async () => {
        const rpc = new TargetRpc('http://unused', 'besu');
        vi.spyOn(rpc, 'send').mockResolvedValue({ contractAddress: DEPLOYED_AT, status: '0x1' });

        await expect(rpc.deployReceiptContractAddress('id', TX_HASH)).resolves.toBe(DEPLOYED_AT);
    });

    it('returns null for a reverted deploy even though the receipt carries an address', async () => {
        const rpc = new TargetRpc('http://unused', 'besu');
        vi.spyOn(rpc, 'send').mockResolvedValue({ contractAddress: DEPLOYED_AT, status: '0x0' });

        await expect(rpc.deployReceiptContractAddress('id', TX_HASH)).resolves.toBeNull();
    });

    it('returns null when the tx has no receipt', async () => {
        const rpc = new TargetRpc('http://unused', 'besu');
        vi.spyOn(rpc, 'send').mockResolvedValue(null);

        await expect(rpc.deployReceiptContractAddress('id', TX_HASH)).resolves.toBeNull();
    });
});

describe('TargetRpc.chainId', () => {
    it('returns the node chain id as a number', async () => {
        const rpc = new TargetRpc('http://unused', 'zksync-os');
        const send = vi.spyOn(rpc, 'send').mockResolvedValue('0x12d');

        await expect(rpc.chainId('id')).resolves.toBe(301);
        expect(send).toHaveBeenCalledWith('id', 'eth_chainId', [], expect.anything());
    });

    it('generates a request id when none is given', async () => {
        const rpc = new TargetRpc('http://unused', 'besu');
        const send = vi.spyOn(rpc, 'send').mockResolvedValue('0x1');

        await expect(rpc.chainId()).resolves.toBe(1);
        expect(send).toHaveBeenCalledWith(expect.any(String), 'eth_chainId', [], expect.anything());
    });
});

describe('TargetRpc.send error mapping', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the node envelope on a non-RpcException error', async () => {
        const nodeError = { code: BAD_RPC_PARAMS_ERROR_CODE, message: 'invalid argument', data: { field: 'hash' } };
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: nodeError }))
        );
        const rpc = new TargetRpc('http://unused', 'zksync-os');

        const err = await rpc.send(1, 'eth_getTransactionReceipt', [TX_HASH], z.unknown()).catch((e) => e);

        expect(err).toBeInstanceOf(TargetRpcCallError);
        expect(err).not.toBeInstanceOf(RpcException);
        expect(err).toMatchObject({
            code: nodeError.code,
            data: nodeError.data,
            method: 'eth_getTransactionReceipt',
            responseMessage: nodeError.message
        });
    });

    it('throws a non-RpcException when the transport fails, so the caller still sees -32603', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
        const rpc = new TargetRpc('http://unused', 'zksync-os');

        const err = await rpc.send(1, 'eth_getTransactionReceipt', [TX_HASH], z.unknown()).catch((e) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(RpcException);
    });
});

describe('upstream RPC duration metric', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function observations(method: string, outcome: string): Promise<number> {
        const { values } = await upstreamRpcDuration.get();
        const count = values.find(
            (v) =>
                v.metricName === 'prividium_upstream_rpc_duration_seconds_count' &&
                v.labels.method === method &&
                v.labels.outcome === outcome
        );
        return count?.value ?? 0;
    }

    it('send observes ok on a JSON-RPC result', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }))
        );
        const rpc = new TargetRpc('http://unused', 'zksync-os');
        const before = await observations('eth_chainId', 'ok');

        await rpc.send(1, 'eth_chainId', [], z.string());

        expect(await observations('eth_chainId', 'ok')).toBe(before + 1);
    });

    it('send observes rpc_error on a JSON-RPC error envelope', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 4, message: 'timeout' } }))
        );
        const rpc = new TargetRpc('http://unused', 'zksync-os');
        const before = await observations('eth_getBalance', 'rpc_error');

        await expect(rpc.send(1, 'eth_getBalance', [TX_HASH], z.unknown())).rejects.toBeInstanceOf(TargetRpcCallError);

        expect(await observations('eth_getBalance', 'rpc_error')).toBe(before + 1);
        expect(await observations('eth_getBalance', 'ok')).toBe(0);
    });

    it('send observes transport_error when fetch rejects', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
        const rpc = new TargetRpc('http://unused', 'zksync-os');
        const before = await observations('eth_getCode', 'transport_error');

        await expect(rpc.send(1, 'eth_getCode', [TX_HASH], z.unknown())).rejects.toThrow('error calling target rpc');

        expect(await observations('eth_getCode', 'transport_error')).toBe(before + 1);
    });

    it('send observes transport_error when the body is not JSON', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>502</html>'));
        const rpc = new TargetRpc('http://unused', 'zksync-os');
        const before = await observations('eth_blockNumber', 'transport_error');

        await expect(rpc.send(1, 'eth_blockNumber', [], z.unknown())).rejects.toThrow('not a valid json');

        expect(await observations('eth_blockNumber', 'transport_error')).toBe(before + 1);
    });

    it('delegate observes ok under the delegated method', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: TX_HASH }))
        );
        const rpc = new TargetRpc('http://unused', 'besu');
        const before = await observations('eth_sendRawTransaction', 'ok');

        await rpc.delegate(1, 'eth_sendRawTransaction', ['0xdeadbeef']);

        expect(await observations('eth_sendRawTransaction', 'ok')).toBe(before + 1);
    });

    it('delegate observes rpc_error on a JSON-RPC error envelope', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'rejected' } }))
        );
        const rpc = new TargetRpc('http://unused', 'besu');
        const before = await observations('eth_sendRawTransaction', 'rpc_error');

        await rpc.delegate(1, 'eth_sendRawTransaction', ['0xdeadbeef']);

        expect(await observations('eth_sendRawTransaction', 'rpc_error')).toBe(before + 1);
    });

    it('delegate observes transport_error when fetch rejects', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
        const rpc = new TargetRpc('http://unused', 'besu');
        const before = await observations('eth_call', 'transport_error');

        await expect(rpc.delegate(1, 'eth_call', [])).rejects.toThrow('ECONNREFUSED');

        expect(await observations('eth_call', 'transport_error')).toBe(before + 1);
    });
});
