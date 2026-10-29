import { areChainAddressesEqual, type ChainAddress } from '@repo/api-kit';
import type { Address } from 'viem';
import { InvalidInputError } from '#utils/error-types';
import { isWellKnownDevAddress } from '#utils/well-known-dev-addresses';

export type WalletAssociationGuard = (addresses: readonly ChainAddress[]) => void;

const REJECTION_MESSAGE =
    'This wallet cannot be associated. Its private key is publicly known and shipped as a dev-tool default.';

export function createWalletAssociationGuard(allowlist: readonly Address[]): WalletAssociationGuard {
    return (addresses) => {
        for (const address of addresses) {
            if (!isWellKnownDevAddress(address)) continue;
            if (allowlist.some((allowed) => areChainAddressesEqual(allowed, address))) continue;
            throw new InvalidInputError(REJECTION_MESSAGE);
        }
    };
}
