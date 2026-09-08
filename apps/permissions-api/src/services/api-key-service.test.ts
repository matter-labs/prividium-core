import { describe, expect, it } from 'vitest';
import { ApiKeyService } from './api-key-service';

describe('ApiKeyService', () => {
    const service = new ApiKeyService();

    describe('generate', () => {
        it('should generate a key with correct format', () => {
            const result = service.generate();

            expect(result.fullKey).toMatch(/^priv_sk_[a-zA-Z0-9]{64}$/);
            expect(result.keyPrefix).toBe(result.fullKey.substring(0, 12));
            expect(result.keyHash).toHaveLength(64); // SHA-256 hex = 64 chars
        });

        it('should generate unique keys each time', () => {
            const key1 = service.generate();
            const key2 = service.generate();

            expect(key1.fullKey).not.toBe(key2.fullKey);
            expect(key1.keyHash).not.toBe(key2.keyHash);
        });

        it('should generate consistent hash for the same key', () => {
            const result = service.generate();
            const rehash = service.hash(result.fullKey);

            expect(rehash).toBe(result.keyHash);
        });
    });

    describe('hash', () => {
        it('should return SHA-256 hash', () => {
            const hash = service.hash('priv_sk_test123');

            expect(hash).toHaveLength(64);
            expect(hash).toMatch(/^[a-f0-9]{64}$/);
        });

        it('should return consistent hash for same input', () => {
            const key = 'priv_sk_abcdef123456';
            const hash1 = service.hash(key);
            const hash2 = service.hash(key);

            expect(hash1).toBe(hash2);
        });

        it('should return different hash for different input', () => {
            const hash1 = service.hash('priv_sk_key1');
            const hash2 = service.hash('priv_sk_key2');

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('validateFormat', () => {
        it('should accept valid key format', () => {
            const key = service.generate().fullKey;
            expect(service.validateFormat(key)).toBe(true);
        });

        it('should reject key without correct prefix', () => {
            expect(service.validateFormat('wrong_prefix_abcdef')).toBe(false);
            expect(service.validateFormat('sk_live_abcdef')).toBe(false);
            expect(service.validateFormat('abcdef')).toBe(false);
        });

        it('should reject key with wrong length random part', () => {
            expect(service.validateFormat('priv_sk_short')).toBe(false);
            expect(service.validateFormat(`priv_sk_${'a'.repeat(63)}`)).toBe(false);
            expect(service.validateFormat(`priv_sk_${'a'.repeat(65)}`)).toBe(false);
        });

        it('should reject key with invalid characters', () => {
            expect(service.validateFormat(`priv_sk_${'a'.repeat(63)}!`)).toBe(false);
            expect(service.validateFormat(`priv_sk_${'a'.repeat(63)} `)).toBe(false);
            expect(service.validateFormat(`priv_sk_${'a'.repeat(63)}-`)).toBe(false);
        });

        it('should accept key with mixed alphanumeric characters', () => {
            // 64 characters of mixed alphanumeric
            const validKey = 'priv_sk_' + 'aA1bB2cC3dD4eE5fF6gG7hH8iI9jJ0kK1lL2mM3nN4oO5pP6qQ7rR8sS9tT0uU1v';
            expect(service.validateFormat(validKey)).toBe(true);
        });
    });

    describe('extractPrefix', () => {
        it('should extract first 12 characters', () => {
            const key = 'priv_sk_abcdefghijklmnop';
            expect(service.extractPrefix(key)).toBe('priv_sk_abcd');
        });

        it('should work with generated keys', () => {
            const generated = service.generate();
            const prefix = service.extractPrefix(generated.fullKey);

            expect(prefix).toHaveLength(12);
            expect(prefix).toBe(generated.keyPrefix);
            expect(generated.fullKey.startsWith(prefix)).toBe(true);
        });
    });
});
