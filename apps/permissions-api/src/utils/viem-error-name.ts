/**
 * Returns a stable viem error class name for logging. Distinguishes ops-relevant
 * failure modes (insufficient funds → top-up operator, nonce collision, RPC
 * timeout, on-chain revert) that would otherwise collapse into one log message.
 */
export function viemErrorName(err: unknown): string {
    if (err && typeof err === 'object' && 'name' in err && typeof err.name === 'string') {
        return err.name;
    }
    if (err instanceof Error) {
        return err.constructor.name;
    }
    return 'Unknown';
}
