import { createHash, createHmac, hkdfSync } from 'node:crypto';
import type { Address } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { it as dbIt, type Fixture } from '../../test/unit-test-context';
import { Repositories } from '../db';
import type { TargetType } from '../db/schema';
import { UnauthorizedError } from '../utils/error-types';
import type { PinoLogger } from '../utils/logger';
import { SiweService } from './siwe-service';

const NONCE_TOKEN_HKDF_SALT = 'prividium-siwe-hmac-v1';
const NONCE_TOKEN_HKDF_INFO = 'siwe-nonce-token';
const NONCE_TOKEN_HKDF_KEY_LENGTH = 32;

type NonceTokenPayloadInput = {
    address: Address;
    nonce: string;
    targetType: TargetType;
    targetId: string | null;
    exp: number;
    iat: number;
    message: string;
};

type SiweServiceTestAccess = {
    generateNonceToken: (payload: NonceTokenPayloadInput) => string;
    verifyNonceToken: (
        token: string,
        expectedNonce: string
    ) => {
        address: Address;
        nonce: string;
        targetType: TargetType;
        targetId: string | null;
        exp: number;
        iat: number;
        messageHash: string;
    };
    verifySiweChallenge: (args: { message: string; nonceToken: string }) => {
        address: Address;
        nonce: string;
        targetType: TargetType;
        targetId: string | null;
        exp: number;
        iat: number;
        messageHash: string;
    };
};

function createService(secret: string, logger?: Pick<PinoLogger, 'warn'>): SiweServiceTestAccess {
    return new SiweService({
        repos: {} as Repositories,
        chainId: 6565,
        hmacSecret: secret,
        logger: logger as PinoLogger | undefined
    }) as unknown as SiweServiceTestAccess;
}

function signPayload(payload: string, secretHex: string): string {
    const rawKey = Buffer.from(secretHex, 'hex');
    const key = Buffer.from(
        hkdfSync(
            'sha256',
            rawKey,
            Buffer.from(NONCE_TOKEN_HKDF_SALT, 'utf8'),
            Buffer.from(NONCE_TOKEN_HKDF_INFO, 'utf8'),
            NONCE_TOKEN_HKDF_KEY_LENGTH
        )
    );
    return createHmac('sha256', key).update(payload).digest('base64url');
}

describe('SiweService nonce token helpers', () => {
    const firstSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const secondSecret = '444556204f4e4c5920686d61632073656372657420646f206e6f742075736521';

    const payload: NonceTokenPayloadInput = {
        address: '0x1234567890123456789012345678901234567890',
        nonce: 'nonce-123',
        targetType: 'user',
        targetId: 'user-1',
        exp: 2_000_000_000,
        iat: 1_999_999_000,
        message: 'test-siwe-message'
    };

    afterEach(() => {
        vi.useRealTimers();
    });

    it('generates and verifies a nonce token', () => {
        const service = createService(firstSecret);

        const token = service.generateNonceToken(payload);
        const verified = service.verifyNonceToken(token, payload.nonce);

        expect(verified.address).toBe(payload.address);
        expect(verified.nonce).toBe(payload.nonce);
        expect(verified.targetType).toBe(payload.targetType);
        expect(verified.targetId).toBe(payload.targetId);
        expect(verified.exp).toBe(payload.exp);
        expect(verified.iat).toBe(payload.iat);
        expect(verified.messageHash).toHaveLength(64);
    });

    it('rejects expired token', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date((payload.exp + 1) * 1000));
        const service = createService(firstSecret);

        const token = service.generateNonceToken(payload);

        expect(() => service.verifyNonceToken(token, payload.nonce)).toThrow(UnauthorizedError);
    });

    it('rejects tampered token', () => {
        const service = createService(firstSecret);
        const token = service.generateNonceToken(payload);
        const [encodedPayload, encodedSignature] = token.split('.');
        const tamperedPayload = Buffer.from(
            Buffer.from(encodedPayload ?? '', 'base64url')
                .toString('utf8')
                .replace(payload.nonce, 'other-nonce'),
            'utf8'
        ).toString('base64url');

        const tamperedToken = `${tamperedPayload}.${encodedSignature}`;
        expect(() => service.verifyNonceToken(tamperedToken, payload.nonce)).toThrow(UnauthorizedError);
    });

    it('rejects token signed with different secret', () => {
        const signerService = createService(firstSecret);
        const verifierService = createService(secondSecret);
        const token = signerService.generateNonceToken(payload);

        expect(() => verifierService.verifyNonceToken(token, payload.nonce)).toThrow(UnauthorizedError);
    });

    it('rejects malformed payload', () => {
        const service = createService(firstSecret);

        expect(() => service.verifyNonceToken('not-a-valid-token', payload.nonce)).toThrow(UnauthorizedError);
    });

    it('rejects unsupported token version', () => {
        const service = createService(firstSecret);
        const token = service.generateNonceToken(payload);
        const [encodedPayload] = token.split('.');
        const mutatedPayload = Buffer.from(encodedPayload ?? '', 'base64url')
            .toString('utf8')
            .replace(/^v1\|/, 'v2|');
        const encodedMutatedPayload = Buffer.from(mutatedPayload, 'utf8').toString('base64url');
        const encodedSignature = signPayload(mutatedPayload, firstSecret);
        const mutatedToken = `${encodedMutatedPayload}.${Buffer.from(encodedSignature, 'base64url').toString('base64url')}`;

        expect(() => service.verifyNonceToken(mutatedToken, payload.nonce)).toThrow(UnauthorizedError);
    });

    it('supports secret rotation by verifying with fallback secret and signing with first secret', () => {
        const rotatingService = createService(`${firstSecret},${secondSecret}`);
        const fallbackOnlyService = createService(secondSecret);
        const tokenSignedByFirst = rotatingService.generateNonceToken(payload);

        expect(() => fallbackOnlyService.verifyNonceToken(tokenSignedByFirst, payload.nonce)).toThrow(
            UnauthorizedError
        );

        const fallbackSigner = createService(secondSecret);
        const tokenSignedBySecond = fallbackSigner.generateNonceToken(payload);
        const verified = rotatingService.verifyNonceToken(tokenSignedBySecond, payload.nonce);
        expect(verified.nonce).toBe(payload.nonce);
    });

    it('logs validation reason while returning generic unauthorized error', () => {
        const logger = { warn: vi.fn() };
        const service = createService(firstSecret, logger);
        const token = service.generateNonceToken(payload);
        const [encodedPayload, encodedSignature] = token.split('.');
        const tamperedPayload = Buffer.from(
            Buffer.from(encodedPayload ?? '', 'base64url')
                .toString('utf8')
                .replace(payload.nonce, 'other-nonce'),
            'utf8'
        ).toString('base64url');

        expect(() => service.verifyNonceToken(`${tamperedPayload}.${encodedSignature}`, payload.nonce)).toThrow(
            UnauthorizedError
        );
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'invalid_signature' }),
            'SIWE nonce token validation failed'
        );
    });

    it('throws at construction when secret is not hex encoded', () => {
        expect(
            () =>
                new SiweService({
                    repos: {} as Repositories,
                    chainId: 6565,
                    hmacSecret: 'not-hex'
                })
        ).toThrow('SIWE HMAC secret must be hex encoded');
    });

    it('throws at construction when secret is shorter than 32 bytes', () => {
        expect(
            () =>
                new SiweService({
                    repos: {} as Repositories,
                    chainId: 6565,
                    hmacSecret: 'abab'
                })
        ).toThrow('SIWE HMAC secret must be at least 32 bytes');
    });
});

describe('SiweService.verifySiweChallenge', () => {
    const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const address = '0x1234567890123456789012345678901234567890' as Address;
    const nonce = 'testnonceabc';
    const chainId = 6565;
    const futureExp = 2_000_000_000;
    const iat = 1_999_999_000;

    function buildMessage(overrides: { expirationTime?: Date } = {}) {
        return createSiweMessage({
            address,
            nonce,
            domain: 'example.com',
            uri: 'prividium:access',
            version: '1',
            chainId,
            statement: 'Test',
            expirationTime: overrides.expirationTime ?? new Date(futureExp * 1000)
        });
    }

    function buildToken(service: SiweServiceTestAccess, message: string) {
        return service.generateNonceToken({
            address,
            nonce,
            targetType: 'user',
            targetId: 'u1',
            exp: futureExp,
            iat,
            message
        });
    }

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns token payload for a valid message and matching nonce token', () => {
        const service = createService(secret);
        const message = buildMessage();
        const nonceToken = buildToken(service, message);

        const result = service.verifySiweChallenge({ message, nonceToken });

        expect(result.address).toBe(address);
        expect(result.nonce).toBe(nonce);
        expect(result.targetType).toBe('user');
        expect(result.targetId).toBe('u1');
    });

    it('throws when the message has been tampered after token issuance', () => {
        const service = createService(secret);
        const originalMessage = buildMessage();
        const nonceToken = buildToken(service, originalMessage);
        const tamperedMessage = originalMessage.replace('Test', 'HACKED');

        expect(() => service.verifySiweChallenge({ message: tamperedMessage, nonceToken })).toThrow(UnauthorizedError);
    });

    it('throws when the SIWE message expiration time has passed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-01-01'));

        const service = createService(secret);
        const expiredMessage = buildMessage({ expirationTime: new Date('2025-01-01') });
        // Token exp is far in the future so the token itself is valid
        const nonceToken = service.generateNonceToken({
            address,
            nonce,
            targetType: 'user',
            targetId: null,
            exp: futureExp,
            iat,
            message: expiredMessage
        });

        expect(() => service.verifySiweChallenge({ message: expiredMessage, nonceToken })).toThrow(UnauthorizedError);
    });
});

describe('SiweService.consumeSiweNonce', () => {
    const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    dbIt('stores the hashed nonce and prevents duplicate consumption', async ({ db }: Fixture) => {
        const repos = new Repositories(db);
        const service = new SiweService({
            repos,
            chainId: 6565,
            hmacSecret: secret
        });

        expect(await service.consumeSiweNonce('nonce-1')).toBe(true);
        expect(await service.consumeSiweNonce('nonce-1')).toBe(false);

        const nonceHash = createHash('sha256').update('nonce-1').digest('hex');
        const stored = await db.query.siweConsumedNoncesTable.findFirst({
            where: (f, { eq }) => eq(f.nonceHash, nonceHash)
        });
        expect(stored).toBeDefined();
    });

    dbIt('uses the provided transaction for nonce consumption', async ({ db }: Fixture) => {
        const repos = new Repositories(db);
        const service = new SiweService({
            repos,
            chainId: 6565,
            hmacSecret: secret
        });

        await expect(
            repos.transaction(async (tx) => {
                await service.consumeSiweNonce('nonce-rollback', tx);
                throw new Error('rollback');
            })
        ).rejects.toThrow('rollback');

        const nonceHash = createHash('sha256').update('nonce-rollback').digest('hex');
        const stored = await db.query.siweConsumedNoncesTable.findFirst({
            where: (f, { eq }) => eq(f.nonceHash, nonceHash)
        });
        expect(stored).toBeUndefined();
    });
});
