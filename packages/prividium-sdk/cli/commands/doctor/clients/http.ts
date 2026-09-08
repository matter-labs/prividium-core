import type { z } from 'zod';
import { getRawReason } from '../utils.js';

export async function requireHttpOk(url: URL): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
        const reason = getRawReason(response.status, await response.text());
        throw new Error(reason);
    }
}

export async function fetchAuthenticatedJson<Schema extends z.ZodTypeAny>(
    schema: Schema,
    url: string,
    token: string
): Promise<z.infer<Schema>> {
    const response = await fetch(url, {
        headers: {
            authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(getRawReason(response.status, await response.text()));
    }

    return schema.parse(await response.json());
}
