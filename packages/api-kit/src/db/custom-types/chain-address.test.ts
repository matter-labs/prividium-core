import { beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { selectChain } from '../../chain/selected-chain';
import { chainAddress } from '../custom-types';

// A chain of its own, so the column is tested against the codec and not against any shipped chain.
const upperHex4 = z
    .string()
    .regex(/^0x[0-9a-fA-F]{8}$/)
    .transform((address) => address.toUpperCase());

describe('chainAddressColumn', () => {
    beforeAll(() => {
        selectChain({
            id: 'test',
            addresses: {
                schema: upperHex4,
                pattern: /^0X[0-9A-F]{8}$/,
                equals: (a, b) => a.toUpperCase() === b.toUpperCase(),
                toBytes: (address) => Buffer.from(upperHex4.parse(address).slice(2), 'hex'),
                fromBytes: (bytes) => `0X${Buffer.from(bytes).toString('hex').toUpperCase()}`
            },
            capabilities: { walletSignIn: false, faucet: false, sequencerCallbacks: false, disclosureMethods: false },
            systemContracts: []
        });
    });

    it('stores the bytes the codec produces', () => {
        expect(chainAddress.toDriver('0xdeadbeef')).toEqual(Buffer.from('deadbeef', 'hex'));
    });

    it('reads a buffer back in the canonical form', () => {
        expect(chainAddress.fromDriver(Buffer.from('deadbeef', 'hex'))).toBe('0XDEADBEEF');
    });

    it('reads the escaped hex string form the driver can return', () => {
        expect(chainAddress.fromDriver('\\xdeadbeef')).toBe('0XDEADBEEF');
    });

    it('refuses a value that is not an address on the chain', () => {
        expect(() => chainAddress.toDriver('not-an-address')).toThrow();
    });
});
