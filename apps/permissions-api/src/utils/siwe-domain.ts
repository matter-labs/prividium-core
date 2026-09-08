import { createSiweMessage } from 'viem/siwe';

// viem's SIWE domain grammar is stricter than a generic host regex (no single-label hosts other than
// localhost, no consecutive dots); probing createSiweMessage guarantees an accepted domain can never
// make challenge creation throw later.
export function isSiweCompatibleDomain(domain: string): boolean {
    try {
        // This probe IS the domain validation: it runs on the candidate entry being accepted
        // and its output is discarded, so the missing-domain-validation rule does not apply.
        // nosemgrep: prividium-siwe-missing-domain-validation
        createSiweMessage({
            address: '0x0000000000000000000000000000000000000000',
            chainId: 1,
            domain,
            nonce: 'aaaaaaaa',
            uri: 'prividium:access',
            version: '1'
        });
        return true;
    } catch {
        return false;
    }
}
