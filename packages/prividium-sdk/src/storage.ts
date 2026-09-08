import { addYears } from 'date-fns/addYears';
import { z } from 'zod';
import { STORAGE_KEYS, type Storage, type TokenData, tokenDataSchema } from './types.js';

export class LocalStorage implements Storage {
    getItem(key: string): string | null {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        return localStorage.getItem(key);
    }

    setItem(key: string, value: string): void {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, value);
        }
    }

    removeItem(key: string): void {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(key);
        }
    }
}

interface SessionDeadlines {
    expiresAt: Date;
    renewableUntil: Date;
}

export class TokenManager {
    storage: Storage;
    private chainId: number;
    private prividiumApiUrl: string;
    private tokenCache: TokenData | null = null;
    private onAuthExpiry: () => void;

    constructor(storage: Storage, chainId: number, prividiumApiUrl: string, onAuthExpiry?: () => void) {
        this.storage = storage;
        this.chainId = chainId;
        this.prividiumApiUrl = prividiumApiUrl;
        this.onAuthExpiry = onAuthExpiry ?? (() => {});
    }

    private get tokenKey(): string {
        return `${STORAGE_KEYS.TOKEN_PREFIX}${this.chainId}`;
    }

    private get stateKey(): string {
        return `${STORAGE_KEYS.STATE_PREFIX}${this.chainId}`;
    }

    getToken(): TokenData | null {
        if (this.tokenCache) {
            return this.tokenCache;
        }

        const tokenDataStr = this.storage.getItem(this.tokenKey);

        if (!tokenDataStr) {
            return null;
        }

        try {
            const parsed = JSON.parse(tokenDataStr) as unknown;
            // Backfill renewableUntil for tokens stored without it (legacy format)
            if (
                parsed !== null &&
                typeof parsed === 'object' &&
                'expiresAt' in parsed &&
                !('renewableUntil' in parsed)
            ) {
                (parsed as Record<string, unknown>).renewableUntil = (parsed as Record<string, unknown>).expiresAt;
            }

            const tokenData = tokenDataSchema.safeParse(parsed);

            if (!tokenData.success) {
                return null;
            }

            if (new Date() > tokenData.data.expiresAt) {
                this.clearToken();
                this.onAuthExpiry();
                return null;
            }

            this.tokenCache = tokenData.data;
            return tokenData.data;
        } catch (e) {
            if (e instanceof SyntaxError) {
                return null;
            }

            throw e;
        }
    }

    private async getTokenExpiration(token: string): Promise<SessionDeadlines> {
        const currentSessionRes = await fetch(new URL('/api/auth/current-session', this.prividiumApiUrl), {
            headers: {
                authorization: `Bearer ${token}`
            }
        });

        // Handle 404 first: indicates /api/auth/current-session is unavailable (older API).
        // The SDK defers expiry handling until a 403 response is received; a far-future date
        // prevents premature onExpiry callbacks before validation fails.
        if (currentSessionRes.status === 404) {
            const farFuture = addYears(new Date(), 100);
            return { expiresAt: farFuture, renewableUntil: farFuture };
        }

        if (!currentSessionRes.ok) {
            throw new Error('Error accessing prividium api');
        }

        const schema = z.object({
            expiresAt: z.iso.datetime(),
            renewableUntil: z.iso.datetime().optional()
        });

        const parsed = schema.safeParse(await currentSessionRes.json());

        if (!parsed.success) {
            throw new Error('Invalid response from prividium api');
        }

        const expiresAt = new Date(parsed.data.expiresAt);
        // Fall back to expiresAt when the API omits renewableUntil (older API versions)
        const renewableUntil = parsed.data.renewableUntil ? new Date(parsed.data.renewableUntil) : expiresAt;

        return { expiresAt, renewableUntil };
    }

    async setToken(rawToken: string): Promise<TokenData> {
        try {
            const { expiresAt, renewableUntil } = await this.getTokenExpiration(rawToken);
            const tokenData: TokenData = { rawToken, expiresAt, renewableUntil };
            this.storage.setItem(this.tokenKey, JSON.stringify(tokenData));
            this.tokenCache = tokenData;
            return tokenData;
        } catch (error) {
            this.clearToken();
            throw error;
        }
    }

    /**
     * Stores token data directly without fetching expiration from the API.
     * Used by SIWE auth where the login response already includes expiresAt.
     */
    setTokenDirect(tokenData: TokenData): void {
        this.storage.setItem(this.tokenKey, JSON.stringify(tokenData));
        this.tokenCache = tokenData;
    }

    clearToken(): void {
        this.tokenCache = null;
        this.storage.removeItem(this.tokenKey);
    }

    isAuthorized(): boolean {
        const tokenData = this.getToken();
        if (tokenData === null) {
            return false;
        }

        const isExpired = new Date() > tokenData.expiresAt;
        if (isExpired) {
            this.onAuthExpiry();
            this.clearToken();
        }

        return !isExpired;
    }

    /**
     * Returns `true` when the stored session uses fixed (non-idle) expiry, i.e. the API
     * returned the same value for `expiresAt` and `renewableUntil` — used to skip the
     * extend loop for sessions that cannot be extended.
     */
    isLegacyFixedExpiry(): boolean {
        const tokenData = this.getToken();
        if (!tokenData) {
            return false;
        }
        return tokenData.expiresAt.getTime() === tokenData.renewableUntil.getTime();
    }

    /**
     * Extends the current session by posting to `/api/auth/extend-session`.
     *
     * - On success: updates stored `expiresAt` and `renewableUntil` from the response.
     * - On 404 (older API) or network error: graceful no-op — keeps current stored values
     *   and does NOT throw.
     * - On 401: clears the token and fires `onAuthExpiry` (mirrors the existing 401 pattern).
     */
    async extend(): Promise<void> {
        const tokenData = this.getToken();
        if (!tokenData) {
            return;
        }

        let extendRes: Response;
        try {
            extendRes = await fetch(new URL('/api/auth/extend-session', this.prividiumApiUrl), {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${tokenData.rawToken}`
                }
            });
        } catch {
            // Network error — graceful no-op
            return;
        }

        if (extendRes.status === 404) {
            // Older API — graceful no-op
            return;
        }

        if (extendRes.status === 401) {
            this.clearToken();
            this.onAuthExpiry();
            return;
        }

        if (!extendRes.ok) {
            // Non-retriable error — graceful no-op to avoid disrupting the user session
            return;
        }

        const schema = z.object({
            expiresAt: z.iso.datetime(),
            renewableUntil: z.iso.datetime().optional()
        });

        const parsed = schema.safeParse(await extendRes.json());
        if (!parsed.success) {
            // Unexpected response shape — keep existing deadlines
            return;
        }

        const newExpiresAt = new Date(parsed.data.expiresAt);
        const newAbsoluteExpiresAt = parsed.data.renewableUntil
            ? new Date(parsed.data.renewableUntil)
            : tokenData.renewableUntil;

        const updated: TokenData = {
            ...tokenData,
            expiresAt: newExpiresAt,
            renewableUntil: newAbsoluteExpiresAt
        };
        this.storage.setItem(this.tokenKey, JSON.stringify(updated));
        this.tokenCache = updated;
    }

    setState(state: string): void {
        this.storage.setItem(this.stateKey, state);
    }

    getState(): string | null {
        return this.storage.getItem(this.stateKey);
    }

    clearState(): void {
        this.storage.removeItem(this.stateKey);
    }
}
