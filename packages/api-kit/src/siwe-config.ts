export type SiweConfig = {
    expirationMs: number;
    chainId: number;
    validDomains: string[];
    hmacSecret?: string;
    challengeRateLimitCount: number;
    challengeRateLimitWindowSeconds: number;
    consumedNonceTtlSeconds: number;
    cleanupIntervalSeconds: number;
    rateLimitBypassIps: string[];
};
