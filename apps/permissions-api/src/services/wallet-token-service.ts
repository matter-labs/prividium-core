import { randomBytes } from 'node:crypto';

export class WalletTokenService {
    generateWalletToken(): string {
        // 128-bits tokens
        return randomBytes(16).toString('base64url');
    }
}
