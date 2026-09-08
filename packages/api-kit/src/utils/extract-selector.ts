import { type Hex, sliceHex } from 'viem';
import { InvalidInputError } from '../error-types';

/**
 * Extracts the 4-byte function selector from calldata.
 * The selector is the first 4 bytes of the keccak256 hash of the function signature.
 */
export function extractSelector(calldata: Hex) {
    try {
        return sliceHex(calldata, 0, 4, { strict: true });
    } catch {
        throw new InvalidInputError('Invalid calldata');
    }
}
