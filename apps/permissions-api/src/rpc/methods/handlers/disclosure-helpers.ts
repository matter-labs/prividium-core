import type { Hex } from 'viem';
import { ForbiddenRpcError } from '../../errors';

/**
 * Reject a selective-disclosure call when the requested block is older than
 * the contract's `disclosureStartBlock`. Shared across all three disclosure
 * handlers (account data, ERC20 supply, ERC20 balance) so the comparison and
 * the error message live in exactly one place.
 */
export function assertBlockAfterDisclosureStart(blockNumber: Hex, disclosureStartBlock: Hex): void {
    if (BigInt(blockNumber) < BigInt(disclosureStartBlock)) {
        throw new ForbiddenRpcError(`Block ${blockNumber} is before disclosure start block ${disclosureStartBlock}`);
    }
}
