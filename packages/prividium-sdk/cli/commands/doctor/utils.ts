import { z } from 'zod';
import type { DoctorContext, NormalizedTargets } from './types.js';

export function passed(
    id: string,
    reason: string
): (ctx: DoctorContext) => { run: true } | { run: false; reason: string };
export function passed(
    ...deps: [string, string][]
): (ctx: DoctorContext) => { run: true } | { run: false; reason: string };
export function passed(...args: unknown[]): (ctx: DoctorContext) => { run: true } | { run: false; reason: string } {
    const deps: [string, string][] =
        typeof args[0] === 'string' ? [[args[0] as string, args[1] as string]] : (args as [string, string][]);
    return (ctx) => {
        for (const [id, reason] of deps) {
            if (!ctx.results.some((r) => r.id === id && r.status === 'pass'))
                return {
                    run: false,
                    reason
                };
        }
        return {
            run: true
        };
    };
}

export function formatHexQuantity(value: string): string {
    if (!value.startsWith('0x')) {
        return value;
    }

    return BigInt(value).toString(10);
}

export function shortenAddress(address: string): string {
    if (address.length <= 12) {
        return address;
    }

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getRawReason(status: number, body: string): string {
    const trimmedBody = body.trim();
    if (trimmedBody.length === 0) {
        return `HTTP ${status}`;
    }

    return `HTTP ${status}: ${trimmedBody}`;
}

export function getThrownReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function validateAndNormalizeUrls(prividiumRpcUrl: string): NormalizedTargets {
    const apiParse = z.url().safeParse(prividiumRpcUrl);
    if (!apiParse.success) {
        throw new Error(`Invalid API url provided: ${prividiumRpcUrl}`);
    }

    return {
        apiBaseUrl: `${new URL(prividiumRpcUrl).origin}/rpc`
    };
}
