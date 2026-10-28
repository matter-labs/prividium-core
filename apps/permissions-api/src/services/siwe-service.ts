import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { hasSystemPermission, type RoleHolder } from '@repo/access-control';
import { areChainAddressesEqual, type ChainAddress } from '@repo/api-kit';
import { fromUnixTime, isFuture } from 'date-fns';
import { type Address, type Hex, verifyMessage } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import type { Repositories, TxType } from '../db';
import { type TargetType, TargetTypes, type UserSource, UserSources } from '../db/schema';
import { AddressSet } from '../rpc/address-set';
import {
    ForbiddenError,
    InvalidInputError,
    UnauthorizedError,
    WalletLoginDisabledError,
    WalletNotLinkedError
} from '../utils/error-types';
import type { PinoLogger } from '../utils/logger';

const NONCE_TOKEN_VERSION = 'v1';
const NONCE_TOKEN_HKDF_SALT = 'prividium-siwe-hmac-v1';
const NONCE_TOKEN_HKDF_INFO = 'siwe-nonce-token';
const NONCE_TOKEN_HKDF_KEY_LENGTH = 32;

type GeneratedNonceTokenPayload = {
    address: Address;
    nonce: string;
    targetType: TargetType;
    targetId: string | null;
    exp: number;
    iat: number;
    message: string;
};

export type NonceTokenPayload = {
    address: Address;
    nonce: string;
    targetType: TargetType;
    targetId: string | null;
    exp: number;
    iat: number;
    messageHash: string;
};

export class SiweService {
    private hmacKeys: Buffer[];
    private repos: Repositories;
    private logger?: PinoLogger;
    private readonly walletLoginEnabled: boolean;
    private readonly walletLoginAllowlist: AddressSet;
    public readonly chainId: number;

    constructor({
        repos,
        chainId,
        hmacSecret,
        walletLoginEnabled,
        walletLoginAllowlist = [],
        watchdogWallets = [],
        logger
    }: {
        repos: Repositories;
        chainId: number;
        hmacSecret?: string;
        walletLoginEnabled: boolean;
        walletLoginAllowlist?: readonly Address[];
        watchdogWallets?: readonly Address[];
        logger?: PinoLogger;
    }) {
        this.repos = repos;
        this.chainId = chainId;
        this.hmacKeys = this.parseAndDeriveHmacKeys(hmacSecret);
        this.walletLoginEnabled = walletLoginEnabled;
        this.walletLoginAllowlist = new AddressSet([...walletLoginAllowlist, ...watchdogWallets]);
        this.logger = logger;
    }

    assertWalletLoginAllowed(targetType: TargetType, address: Address): void {
        if (this.walletLoginEnabled) return;
        if (targetType === TargetTypes.enum.user && this.walletLoginAllowlist.has(address)) return;
        throw new WalletLoginDisabledError();
    }

    /** `rpc` when the login skips SSO: always for the watchdog, and for an allowlisted wallet while wallet login is off. */
    sessionScopeFor(
        user: RoleHolder & { source: UserSource; wallets: readonly { walletAddress: ChainAddress }[] },
        address: Address
    ): 'rpc' | undefined {
        if (this.walletLoginEnabled && user.source !== UserSources.enum.watchdog) return undefined;
        if (!user.wallets.some((wallet) => areChainAddressesEqual(wallet.walletAddress, address))) {
            throw new WalletNotLinkedError();
        }
        if (hasSystemPermission(user, 'admin_read') || hasSystemPermission(user, 'admin_write')) {
            throw new ForbiddenError('Admins cannot log in without SSO.');
        }
        return 'rpc';
    }

    async validateSiwe({ message, signature, nonceToken }: { message: string; signature: Hex; nonceToken: string }) {
        return this.validateSiweMessage({ message, signature, nonceToken, markNonceAsUsed: true });
    }

    /**
     * Validates SIWE signature without marking the nonce as used.
     * Used for admin MFA flow where nonce consumption is deferred until MFA completes.
     */
    async validateSiweDeferred({
        message,
        signature,
        nonceToken
    }: {
        message: string;
        signature: Hex;
        nonceToken: string;
    }) {
        return this.validateSiweMessage({ message, signature, nonceToken, markNonceAsUsed: false });
    }

    /**
     * Verifies the nonce token and checks that the message matches it and has not expired.
     * Does NOT verify the cryptographic signature or consume the nonce — those are the caller's responsibility.
     */
    verifySiweChallenge({ message, nonceToken }: { message: string; nonceToken: string }): NonceTokenPayload {
        const { nonce: messageNonce, expirationTime } = parseSiweMessage(message);
        if (!messageNonce) {
            throw new InvalidInputError('Invalid siwe message');
        }

        const tokenPayload = this.verifyNonceToken(nonceToken, messageNonce);
        const messageHash = createHash('sha256').update(message).digest('hex');
        if (tokenPayload.messageHash !== messageHash) {
            throw new UnauthorizedError();
        }

        if (expirationTime && !isFuture(new Date(expirationTime))) {
            throw new UnauthorizedError();
        }

        return tokenPayload;
    }

    private async validateSiweMessage({
        message,
        signature,
        nonceToken,
        markNonceAsUsed
    }: {
        message: string;
        signature: Hex;
        nonceToken: string;
        markNonceAsUsed: boolean;
    }) {
        const tokenPayload = this.verifySiweChallenge({ message, nonceToken });

        const messageVerified = await verifyMessage({
            signature,
            message,
            address: tokenPayload.address
        }).catch(() => false);
        if (!messageVerified) throw new UnauthorizedError();
        this.assertWalletLoginAllowed(tokenPayload.targetType, tokenPayload.address);

        if (markNonceAsUsed) {
            const consumed = await this.consumeSiweNonce(tokenPayload.nonce);
            if (!consumed) {
                throw new UnauthorizedError();
            }
        }

        return tokenPayload;
    }

    /**
     * Marks a SIWE nonce as used. Called after MFA success.
     */
    async consumeSiweNonce(nonce: string, tx?: TxType) {
        const repo = tx ? tx.repositories().consumedNonces : this.repos.consumedNonces;
        const nonceHash = createHash('sha256').update(nonce).digest('hex');
        return repo.insertHash(nonceHash);
    }

    generateNonceToken(payload: GeneratedNonceTokenPayload): string {
        const messageHash = createHash('sha256').update(payload.message).digest('hex');
        const payloadToSign = [
            NONCE_TOKEN_VERSION,
            payload.address,
            payload.nonce,
            payload.targetType,
            payload.targetId ?? '',
            payload.exp.toString(),
            payload.iat.toString(),
            messageHash
        ].join('|');

        const key = this.hmacKeys[0];
        if (key === undefined) {
            throw new Error('SIWE HMAC secret is not configured');
        }

        const signature = this.createHmacSignature(payloadToSign, key);
        const encodedPayload = Buffer.from(payloadToSign, 'utf8').toString('base64url');

        return `${encodedPayload}.${signature}`;
    }

    verifyNonceToken(token: string, expectedNonce: string): NonceTokenPayload {
        const [encodedPayload, encodedSignature, ...rest] = token.split('.');
        if (!encodedPayload || !encodedSignature || rest.length > 0) {
            this.throwInvalidNonceToken('invalid_format');
        }

        const payloadString = this.decodeTokenSegment(encodedPayload, 'payload').toString('utf8');
        const providedSignature = this.decodeTokenSegment(encodedSignature, 'signature');

        // Iterate all keys even after a match to avoid timing side-channels during
        // secret rotation (early exit via .some() would leak which key slot matched).
        let isValidSignature = false;
        for (const key of this.hmacKeys) {
            const expectedSignature = Buffer.from(this.createHmacSignature(payloadString, key), 'base64url');
            if (expectedSignature.length === providedSignature.length) {
                const matches = timingSafeEqual(expectedSignature, providedSignature);
                if (matches) isValidSignature = true;
            }
        }
        if (!isValidSignature) {
            this.throwInvalidNonceToken('invalid_signature');
        }

        const [version, address, nonce, targetType, targetId, exp, iat, messageHash] = payloadString.split('|');
        if (version !== NONCE_TOKEN_VERSION) {
            this.throwInvalidNonceToken('unsupported_version', { version: version ?? 'unknown' });
        }
        if (!nonce || nonce !== expectedNonce) {
            this.throwInvalidNonceToken('nonce_mismatch');
        }
        if (!address) {
            this.throwInvalidNonceToken('invalid_address');
        }

        const targetTypeResult = TargetTypes.safeParse(targetType);
        if (!targetTypeResult.success) {
            this.throwInvalidNonceToken('invalid_target_type');
        }

        const expSeconds = Number(exp);
        const iatSeconds = Number(iat);
        if (!isFuture(fromUnixTime(expSeconds))) {
            this.throwInvalidNonceToken('expired');
        }
        if (!messageHash) {
            this.throwInvalidNonceToken('invalid_message_hash');
        }

        return {
            address: address as Address,
            nonce,
            targetType: targetTypeResult.data,
            targetId: targetId || null,
            exp: expSeconds,
            iat: iatSeconds,
            messageHash
        };
    }

    private createHmacSignature(payload: string, key: Buffer): string {
        return createHmac('sha256', key).update(payload).digest('base64url');
    }

    private parseAndDeriveHmacKeys(secretList: string | undefined): Buffer[] {
        if (!secretList) {
            return [];
        }

        return secretList
            .split(',')
            .map((secret) => secret.trim())
            .filter((secret) => secret.length > 0)
            .map((secretHex) => {
                if (!/^[a-fA-F0-9]+$/.test(secretHex) || secretHex.length % 2 !== 0) {
                    throw new Error('SIWE HMAC secret must be hex encoded');
                }

                const rawKey = Buffer.from(secretHex, 'hex');
                if (rawKey.length < 32) {
                    throw new Error('SIWE HMAC secret must be at least 32 bytes');
                }

                return Buffer.from(
                    hkdfSync(
                        'sha256',
                        rawKey,
                        Buffer.from(NONCE_TOKEN_HKDF_SALT, 'utf8'),
                        Buffer.from(NONCE_TOKEN_HKDF_INFO, 'utf8'),
                        NONCE_TOKEN_HKDF_KEY_LENGTH
                    )
                );
            });
    }

    private decodeTokenSegment(segment: string, segmentName: string): Buffer {
        try {
            return Buffer.from(segment, 'base64url');
        } catch {
            this.throwInvalidNonceToken('invalid_encoding', { segmentName });
        }
    }

    private throwInvalidNonceToken(reason: string, details: Record<string, unknown> = {}): never {
        this.logger?.warn({ reason, ...details }, 'SIWE nonce token validation failed');
        throw new UnauthorizedError();
    }
}
