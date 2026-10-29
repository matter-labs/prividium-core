import { type Address, getAddress, toFunctionSelector, toFunctionSignature } from 'viem';
import { describe, expect, it } from 'vitest';
import { ZKSYNC_SYSTEM_CONTRACTS } from '#chains/evm/system-contracts';
import { abiFromString } from '#utils/abi';
import { canInheritSystemContractUmbrella, SYSTEM_CONTRACT_UMBRELLA_POLICIES } from './umbrella-policy';

describe('system-contract umbrella policy consistency', () => {
    it.each(
        Object.entries(SYSTEM_CONTRACT_UMBRELLA_POLICIES)
    )('keeps %s and its allowed signatures in the registry', (address, policy) => {
        const contract = ZKSYNC_SYSTEM_CONTRACTS.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
        expect(contract).toBeDefined();
        const signatures = abiFromString(contract!.abi)
            .filter((item) => item.type === 'function')
            .map(toFunctionSignature);
        for (const signature of [...policy.methods, ...(policy.optionalReads ?? [])]) {
            expect(signatures).toContain(signature);
        }
    });

    it.each(
        Object.entries(SYSTEM_CONTRACT_UMBRELLA_POLICIES)
    )('enforces %s for lowercase and checksummed addresses', (address, policy) => {
        for (const variant of [address.toLowerCase() as Address, getAddress(address)]) {
            for (const allowReads of [false, true]) {
                expect(canInheritSystemContractUmbrella(variant, '0xdeadbeef', allowReads)).toBe(false);
                for (const signature of policy.methods) {
                    expect(canInheritSystemContractUmbrella(variant, toFunctionSelector(signature), allowReads)).toBe(
                        true
                    );
                }
                for (const signature of policy.optionalReads ?? []) {
                    expect(canInheritSystemContractUmbrella(variant, toFunctionSelector(signature), allowReads)).toBe(
                        allowReads
                    );
                }
            }
        }
    });
});
