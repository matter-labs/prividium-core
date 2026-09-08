import { z } from 'zod';
import { UNAUTHORIZED_ERROR_CODE } from './rpc-error-codes.js';

const jsonRpcErrorSchema = z.object({
    error: z.object({
        code: z.number(),
        message: z.string().optional(),
        data: z.unknown().optional()
    })
});

const apiErrorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string()
    })
});

/**
 * Checks if a Response contains a Prividium unauthorized/forbidden error.
 */
export async function hasPrividiumUnauthorizedError(response: Response): Promise<boolean> {
    try {
        const clonedResponse = response.clone();
        const parsed = jsonRpcErrorSchema.safeParse(await clonedResponse.json());
        if (parsed.success) {
            return parsed.data.error.code === UNAUTHORIZED_ERROR_CODE;
        }
        return false;
    } catch {
        return false;
    }
}

export function isPrividiumUnauthorizedRpcError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const value = error as { code?: unknown; cause?: unknown };
    if (value.code === UNAUTHORIZED_ERROR_CODE) {
        return true;
    }

    return isPrividiumUnauthorizedRpcError(value.cause);
}

/**
 * Extracts a human-readable error string from a failed HTTP response.
 * Attempts to parse the server's `{ error: { code, message } }` JSON structure,
 * falls back to plain text, and ultimately to status + statusText.
 * Never throws — always returns a usable string.
 */
export async function extractResponseError(response: Response): Promise<string> {
    const base = `${response.status} ${response.statusText}`;

    try {
        const cloned = response.clone();
        const text = await cloned.text();
        if (!text) {
            return base;
        }

        try {
            const json = JSON.parse(text);
            const parsed = apiErrorSchema.safeParse(json);
            if (parsed.success) {
                const { code, message } = parsed.data.error;
                return `${base}: ${message} (${code})`;
            }
        } catch {
            // Not JSON
        }

        return `${base}: ${text}`;
    } catch {
        // Body unreadable
    }

    return base;
}
