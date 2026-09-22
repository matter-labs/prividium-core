import { type Address, getAddress, toFunctionSelector, toFunctionSignature } from 'viem';
import { describe, expect, it } from 'vitest';
import { abiFromString } from '../../utils/abi';
import { SYSTEM_CONTRACTS_REGISTRY } from './registry';
import { canInheritSystemContractUmbrella, SYSTEM_CONTRACT_UMBRELLA_POLICIES } from './umbrella-policy';

describe('system-contract umbrella policy consistency', () => {
    it.each(
        Object.entries(SYSTEM_CONTRACT_UMBRELLA_POLICIES)
    )('keeps %s and its allowed signatures in the registry', (address, policy) => {
        const contract = SYSTEM_CONTRACTS_REGISTRY.find(
            (entry) => entry.contractAddress.toLowerCase() === address.toLowerCase()
        );
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
