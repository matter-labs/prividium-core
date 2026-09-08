import { getAddress, pad } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';
import { type CliStack, CliStackBuilder } from './cli-test-utils/cli-stack.js';
import { runCli } from './cli-test-utils/run-cli.js';
import {
    BYTECODES_CLI_ARG,
    CONTRACT_ADDRESS,
    DIAMOND_ADDRESS,
    TOKEN_TOTAL_SUPPLY
} from './cli-test-utils/verify-fixtures.js';

const BLOCK_NUMBER_HEX = '0x1da';

// Pass every config value as a CLI flag so `readAndUpdatedRequiredFields` never
// falls through to a user prompt (which would hang the in-process test runner).
function commonCliArgs(stack: CliStack): string[] {
    return [
        '--block-number',
        BLOCK_NUMBER_HEX,
        '--api-url',
        stack.prividium.url,
        '--l1',
        stack.l1.url,
        '--zksync-os-rpc',
        stack.l2.url,
        '--diamond-address',
        DIAMOND_ADDRESS,
        '--config-path',
        stack.configPath
    ];
}

function erc20SupplyCliArgs(stack: CliStack): string[] {
    return [
        'verify',
        'erc20-total-supply',
        CONTRACT_ADDRESS,
        ...commonCliArgs(stack),
        '--bytecodes',
        BYTECODES_CLI_ARG
    ];
}

describe('CLI `verify erc20-total-supply`', () => {
    let stack: CliStack | undefined;

    afterEach(async () => {
        await stack?.close();
        stack = undefined;
    });

    it('verifies supply successfully against when RPC returns valid data', async () => {
        stack = await new CliStackBuilder().build();

        const { exitCode, stdout, stderr } = await runCli(erc20SupplyCliArgs(stack));

        expect(stderr).toBe('');
        expect(exitCode).toBe(0);
        expect(stdout).toContain(`Supply: ${TOKEN_TOTAL_SUPPLY}`);

        expect(stack.prividium.requests).toHaveLength(1);
        expect(stack.prividium.requests[0]?.method).toBe('prividium_tokenSupplyDisclosure');
        expect(stack.prividium.requests[0]?.params).toEqual([getAddress(CONTRACT_ADDRESS), BLOCK_NUMBER_HEX]);

        expect(stack.l1.requests.some((r) => r.method === 'eth_call')).toBe(true);
        expect(stack.l2.requests.some((r) => r.method === 'debug_traceCall')).toBe(true);
    }, 30_000);

    it('exits non-zero when the prividium RPC returns an error', async () => {
        stack = await new CliStackBuilder()
            .withPrividiumMethod('prividium_tokenSupplyDisclosure', () => {
                throw new Error('disclosure unavailable');
            })
            .build();

        const { exitCode, stdout } = await runCli(erc20SupplyCliArgs(stack));

        expect(exitCode).toBe(1);
        expect(stdout).toContain('Error fetching proofs');
    }, 30_000);

    it('exits non-zero when the L1 commitment does not match', async () => {
        stack = await new CliStackBuilder().withL1Method('eth_call', () => pad('0x')).build();

        const { exitCode, stdout } = await runCli(erc20SupplyCliArgs(stack));

        expect(exitCode).toBe(1);
        expect(stdout).toContain('Verification failed');
    }, 30_000);

    it('reports a specific error when bytecode for the token contract is missing', async () => {
        stack = await new CliStackBuilder().build();

        const { exitCode, stdout } = await runCli([
            'verify',
            'erc20-total-supply',
            CONTRACT_ADDRESS,
            ...commonCliArgs(stack)
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toContain('Missing bytecode');
        expect(stdout).toContain(CONTRACT_ADDRESS);
    }, 30_000);
});
