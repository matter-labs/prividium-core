export type UserTokenVerifyError = 'network_error' | 'invalid_token' | 'server_error';

export type UserTokenVerifyResult =
    | { valid: true; userId: string }
    | { valid: false; error: UserTokenVerifyError; cause?: unknown };

export interface VerifyUserAccessTokenOptions {
    apiUrl: string;
    /** Called with the underlying Error before returning a `{ valid: false }` result. */
    onError?: (error: unknown) => void;
}

export async function verifyUserAccessToken(
    token: string,
    options: VerifyUserAccessTokenOptions
): Promise<UserTokenVerifyResult> {
    const authorizationHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    let response: Response;
    try {
        response = await fetch(new URL('/api/profiles/me', options.apiUrl), {
            method: 'GET',
            headers: {
                Authorization: authorizationHeader,
                'Content-Type': 'application/json'
            }
        });
    } catch (cause) {
        options.onError?.(cause);
        return { valid: false, error: 'network_error', cause };
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            return { valid: false, error: 'invalid_token' };
        }
        return { valid: false, error: 'server_error' };
    }

    let parsed: unknown;
    try {
        parsed = await response.json();
    } catch (cause) {
        options.onError?.(cause);
        return { valid: false, error: 'server_error', cause };
    }

    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { id?: unknown }).id !== 'string') {
        return { valid: false, error: 'invalid_token' };
    }

    return { valid: true, userId: (parsed as { id: string }).id };
}
