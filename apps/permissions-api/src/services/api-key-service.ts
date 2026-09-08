import { createHash } from 'node:crypto';
import { secureRandomString } from '../utils/crypto';

const API_KEY_PREFIX = 'priv_sk_';
const API_KEY_RANDOM_LENGTH = 64;

export interface GeneratedApiKey {
    /** The full API key - only available at generation time */
    fullKey: string;
    /** SHA-256 hash of the key for storage */
    keyHash: string;
    /** First 12 characters for display (e.g., "priv_sk_XXXX") */
    keyPrefix: string;
}

export class ApiKeyService {
    /**
     * Generates a new API key with all necessary components for storage
     * @returns Object containing fullKey (show once), keyHash (store), keyPrefix (display)
     */
    generate(): GeneratedApiKey {
        const fullKey = this.generateKey();
        return {
            fullKey,
            keyHash: this.hash(fullKey),
            keyPrefix: this.extractPrefix(fullKey)
        };
    }

    /**
     * Hashes a key for lookup/comparison
     * @param key - The API key to hash
     * @returns SHA-256 hash
     */
    hash(key: string): string {
        return createHash('sha256').update(key).digest('hex');
    }

    /**
     * Validates the format of an API key
     * @param key - The key to validate
     * @returns true if valid format
     */
    validateFormat(key: string): boolean {
        if (!key.startsWith(API_KEY_PREFIX)) {
            return false;
        }
        const randomPart = key.substring(API_KEY_PREFIX.length);
        if (randomPart.length !== API_KEY_RANDOM_LENGTH) {
            return false;
        }
        return /^[a-zA-Z0-9]+$/.test(randomPart);
    }

    /**
     * Extracts the display prefix from an API key
     * @param key - The full API key
     * @returns The prefix (first 12 chars, e.g.: priv_sk_AD4d)
     */
    extractPrefix(key: string): string {
        return key.substring(0, 12);
    }

    /**
     * Generates a new API key with format: priv_sk_<64 random alphanumeric chars>
     * Total length: 8 (prefix) + 64 (random) = 72 characters
     */
    private generateKey(): string {
        const random = secureRandomString(API_KEY_RANDOM_LENGTH);
        return `${API_KEY_PREFIX}${random}`;
    }
}

export const apiKeyService = new ApiKeyService();
