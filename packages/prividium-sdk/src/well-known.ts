import { z } from 'zod';

const hexSchema = z.templateLiteral(['0x', z.string().regex(/^[0-9a-fA-F]+$/)]);
const addressSchema = z.templateLiteral(['0x', z.string().regex(/^[0-9a-fA-F]{40}$/)]);

export const prividiumSystemInfoSchema = z.object({
    blockExplorerUrl: z.url(),
    chainId: hexSchema,
    chainName: z.string(),
    baseToken: z.object({
        name: z.string(),
        symbol: z.string(),
        decimals: z.number(),
        l1Address: addressSchema.nullable()
    }),
    rpcUrl: z.url(),
    userPanelUrl: z.url(),
    version: z.string(),
    l1ChainId: hexSchema,
    l1ChainName: z.string(),
    // Per-deployment list of wallet EIP-6963 rdns ids (e.g. ['io.metamask']) that narrows which
    // wallets the user panel features in its connect picker. Curation only — any wallet can still
    // connect via WalletConnect. `.nullish()` so a backend that doesn't send the field still parses
    // (a narrower/older deploy); absent/null means "feature all wallets the app knows".
    featuredWalletIds: z.array(z.string()).nullish()
});

const wellKnownSchema = z.object({
    v1: prividiumSystemInfoSchema
});

export type PrividiumSystemInfo = z.infer<typeof prividiumSystemInfoSchema>;

export type PrividiumWellKnownErrorKind = 'network' | 'http' | 'schema';

export class PrividiumWellKnownError extends Error {
    readonly kind: PrividiumWellKnownErrorKind;
    constructor(kind: PrividiumWellKnownErrorKind, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'PrividiumWellKnownError';
        this.kind = kind;
    }
}

const DEFAULT_TIMEOUT_MS = 5000;

export type FetchPrividiumConfigOptions = {
    signal?: AbortSignal;
    fetch?: typeof fetch;
};

export async function fetchPrividiumConfig(
    apiUrl: string,
    opts?: FetchPrividiumConfigOptions
): Promise<PrividiumSystemInfo> {
    const url = new URL('/.well-known/prividium', apiUrl).toString();
    const doFetch = opts?.fetch ?? fetch;
    const signal = opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
        response = await doFetch(url, { signal });
    } catch (cause) {
        throw new PrividiumWellKnownError(
            'network',
            `Could not reach ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause }
        );
    }

    if (!response.ok) {
        throw new PrividiumWellKnownError('http', `Unexpected HTTP ${response.status} from ${url}`);
    }

    let json: unknown;
    try {
        json = await response.json();
    } catch (cause) {
        throw new PrividiumWellKnownError('schema', `Response from ${url} was not valid JSON`, { cause });
    }

    const parsed = wellKnownSchema.safeParse(json);
    if (!parsed.success) {
        throw new PrividiumWellKnownError(
            'schema',
            `Response from ${url} did not match the Prividium well-known shape: ${parsed.error.message}`,
            { cause: parsed.error }
        );
    }

    return parsed.data.v1;
}
