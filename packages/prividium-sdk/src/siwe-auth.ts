import type { Address, LocalAccount } from 'viem';
import { z } from 'zod';
import { extractResponseError } from './error-utils.js';
import type { TokenManager } from './storage.js';
import type { TokenData } from './types.js';

export interface SiweAuthConfig {
    account: LocalAccount;
    prividiumApiBaseUrl: string;
    domain?: string;
    tokenManager: TokenManager;
}

const siweMessageResponseSchema = z.object({
    msg: z.string(),
    nonceToken: z.string()
});

const siweLoginResponseSchema = z.object({
    token: z.string(),
    expiresAt: z.string(),
    renewableUntil: z.string().optional()
});

const mfaResponseSchema = z.object({
    requiresMfa: z.literal(true)
});

export class SiweAuth {
    private config: SiweAuthConfig;

    constructor(config: SiweAuthConfig) {
        this.config = config;
    }

    get address(): Address {
        return this.config.account.address;
    }

    async authorize(): Promise<TokenData> {
        // Step 1: Request SIWE message
        const siweResponse = await fetch(new URL('/api/siwe-messages', this.config.prividiumApiBaseUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                address: this.config.account.address,
                ...(this.config.domain && { domain: this.config.domain })
            })
        });

        if (!siweResponse.ok) {
            const detail = await extractResponseError(siweResponse);
            throw new Error(`Failed to get SIWE message: ${detail}`);
        }

        const siweData = siweMessageResponseSchema.parse(await siweResponse.json());

        // Step 2: Sign the message
        const signature = await this.config.account.signMessage({ message: siweData.msg });

        // Step 3: Login
        const loginResponse = await fetch(new URL('/api/auth/login/crypto-native', this.config.prividiumApiBaseUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: siweData.msg, signature, nonceToken: siweData.nonceToken })
        });

        if (!loginResponse.ok) {
            const detail = await extractResponseError(loginResponse);
            throw new Error(`SIWE login failed: ${detail}`);
        }

        const loginJson = await loginResponse.json();

        // Check for MFA requirement (admin users with passkeys)
        const mfaParsed = mfaResponseSchema.safeParse(loginJson);
        if (mfaParsed.success) {
            throw new Error('SIWE login requires MFA which is not supported in programmatic auth');
        }

        const loginData = siweLoginResponseSchema.parse(loginJson);

        // Step 4: Store token directly (login response includes expiresAt)
        const expiresAt = new Date(loginData.expiresAt);
        const tokenData: TokenData = {
            rawToken: loginData.token,
            expiresAt,
            // Fall back to expiresAt when the API omits renewableUntil (older API versions)
            renewableUntil: loginData.renewableUntil ? new Date(loginData.renewableUntil) : expiresAt
        };

        this.config.tokenManager.setTokenDirect(tokenData);

        return tokenData;
    }

    unauthorize(): void {
        this.config.tokenManager.clearToken();
    }

    isAuthorized(): boolean {
        return this.config.tokenManager.isAuthorized();
    }
}
