import { type Address, isAddressEqual } from 'viem';
import type { User } from '../repositories/users-repository';

export function userHasWallet(user: User, walletAddress: Address): boolean {
    return user.wallets.some((w) => isAddressEqual(w.walletAddress, walletAddress));
}
