import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { customAlphabet } from 'nanoid';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function encryptToFile(content: Buffer, key: Buffer, filePath: string) {
    // 1. Generate a unique Initialization Vector (IV) for each encryption.
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);

    // Get the authentication tag.
    const authTag = cipher.getAuthTag();

    // 5. Combine IV, auth tag, and encrypted data for storage or transmission.
    // We are returning them as hex-encoded strings.
    const fileContent = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;

    writeFileSync(filePath, fileContent);
}

export function decryptFromFile(filePath: string, key: Buffer): Buffer {
    const payload = readFileSync(filePath).toString();
    // Split the payload into its parts.
    const [ivHex, authTagHex, encryptedHex] = payload.split(':');

    if (ivHex === undefined || authTagHex === undefined || encryptedHex === undefined) {
        throw new Error('wrong message format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

const generator = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 96);
export function secureRandomString(size?: number): string {
    return generator(size);
}
