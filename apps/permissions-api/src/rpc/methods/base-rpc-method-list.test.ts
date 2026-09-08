import { describe, expect, it } from 'vitest';
import { createBaseRpcMethodList } from './base-rpc-method-list';

const DISCLOSURE_METHOD_NAMES = [
    'prividium_storageDisclosureContract',
    'prividium_tokenSupplyDisclosure',
    'prividium_tokenBalanceDisclosure',
    'prividium_accountDataDisclosure'
] as const;

describe('createBaseRpcMethodList', () => {
    it('omits selective disclosure methods when disclosureMethodsEnabled is false', () => {
        const methods = createBaseRpcMethodList([], false);
        const names = new Set(methods.map((m) => m.name));
        for (const name of DISCLOSURE_METHOD_NAMES) {
            expect(names.has(name)).toBe(false);
        }
    });

    it('includes selective disclosure methods when disclosureMethodsEnabled is true', () => {
        const methods = createBaseRpcMethodList([], true);
        const names = new Set(methods.map((m) => m.name));
        for (const name of DISCLOSURE_METHOD_NAMES) {
            expect(names.has(name)).toBe(true);
        }
    });

    it('registers each method exactly once', () => {
        const methods = createBaseRpcMethodList([], true);
        const names = methods.map((m) => m.name);
        const dupes = names.filter((name, idx) => names.indexOf(name) !== idx);
        expect(dupes).toEqual([]);
    });
});
