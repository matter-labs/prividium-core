import { type Address, isAddressEqual } from 'viem';
import { InvalidInputError } from '../utils/error-types';
import { isWellKnownDevAddress } from '../utils/well-known-dev-addresses';

export type WalletAssociationGuard = (addresses: readonly Address[]) => void;

const REJECTION_MESSAGE =
    'This wallet cannot be associated. Its private key is publicly known and shipped as a dev-tool default.';

export function createWalletAssociationGuard(allowlist: readonly Address[]): WalletAssociationGuard {
    return (addresses) => {
        for (const address of addresses) {
            if (!isWellKnownDevAddress(address)) continue;
            if (allowlist.some((allowed) => isAddressEqual(allowed, address))) continue;
            throw new InvalidInputError(REJECTION_MESSAGE);
        }
    };
}
