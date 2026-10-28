import { areChainAddressesEqual, type ChainAddress } from '@repo/api-kit';
import type { User } from '../repositories/users-repository';

export function userHasWallet(user: User, walletAddress: ChainAddress): boolean {
    return user.wallets.some((w) => areChainAddressesEqual(w.walletAddress, walletAddress));
}
