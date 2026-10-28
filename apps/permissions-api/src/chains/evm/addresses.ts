import { type AddressCodec, addressSchema, type ChainAddress } from '@repo/api-kit';
import { type Address, bytesToHex, hexToBytes } from 'viem';

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const EVM_ADDRESSES: AddressCodec = {
    schema: addressSchema,
    pattern: EVM_ADDRESS_PATTERN,
    equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
    toBytes: (address) => hexToBytes(addressSchema.parse(address)),
    fromBytes: (bytes) => addressSchema.parse(bytesToHex(bytes))
};

export function isEvmAddress(address: ChainAddress): address is Address {
    return EVM_ADDRESS_PATTERN.test(address);
}
