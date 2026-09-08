import { getAddress, pad } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';
import { type CliStack, CliStackBuilder } from './cli-test-utils/cli-stack.js';
import { runCli } from './cli-test-utils/run-cli.js';
import {
    ACCOUNT_BYTECODE,
    ACCOUNT_DATA_DISCLOSURE,
    ACCOUNT_DATA_L1_BATCH_HASH,
    ACCOUNT_PROPERTIES,
    CONTRACT_ADDRESS,
    DIAMOND_ADDRESS
} from './cli-test-utils/verify-fixtures.js';

const BLOCK_NUMBER_HEX = '0x1';

// Pass every config value as a CLI flag so `readAndUpdatedRequiredFields` never
// falls through to a user prompt (which would hang the in-process test runner).
function accountDataCliArgs(stack: CliStack): string[] {
    return [
        'verify',
        'account-data',
        CONTRACT_ADDRESS,
        '--block-number',
        BLOCK_NUMBER_HEX,
        '--apiUrl',
        stack.prividium.url,
        '--l1',
        stack.l1.url,
        '--diamond-address',
        DIAMOND_ADDRESS,
        '--expected-bytecode',
        ACCOUNT_BYTECODE,
        '--config-path',
        stack.configPath
    ];
}

describe('CLI `verify account-data`', () => {
    let stack: CliStack | undefined;

    afterEach(async () => {
        await stack?.close();
        stack = undefined;
    });

    it('verifies account data successfully when the RPC returns valid data', async () => {
        stack = await new CliStackBuilder().withL1Method('eth_call', () => ACCOUNT_DATA_L1_BATCH_HASH).build();

        const { exitCode, stdout, stderr } = await runCli(accountDataCliArgs(stack));

        expect(stderr).toBe('');
        expect(exitCode).toBe(0);
        expect(stdout).toContain(`Address: ${getAddress(CONTRACT_ADDRESS)}`);
        expect(stdout).toContain(`Balance: ${ACCOUNT_PROPERTIES.balance}`);
        expect(stdout).toContain(`Nonce: ${ACCOUNT_PROPERTIES.nonce}`);
        expect(stdout).toContain(`Bytecode: ${ACCOUNT_DATA_DISCLOSURE.bytecode}`);

        expect(stack.prividium.requests).toHaveLength(1);
        expect(stack.prividium.requests[0]?.method).toBe('prividium_accountDataDisclosure');
        expect(stack.prividium.requests[0]?.params).toEqual([getAddress(CONTRACT_ADDRESS), BLOCK_NUMBER_HEX]);
    }, 30_000);

    it('exits non-zero when the prividium RPC returns an error', async () => {
        stack = await new CliStackBuilder()
            .withPrividiumMethod('prividium_accountDataDisclosure', () => {
                throw new Error('disclosure unavailable');
            })
            .build();

        const { exitCode, stdout } = await runCli(accountDataCliArgs(stack));

        expect(exitCode).toBe(1);
        expect(stdout).toContain('Error fetching proofs');
    }, 30_000);

    it('exits non-zero when the L1 commitment does not match', async () => {
        stack = await new CliStackBuilder().withL1Method('eth_call', () => pad('0x')).build();

        const { exitCode, stdout } = await runCli(accountDataCliArgs(stack));

        expect(exitCode).toBe(1);
        expect(stdout).toContain('Verification failed');
    }, 30_000);

    it('exits non-zero when the requested address is not a valid hex address', async () => {
        stack = await new CliStackBuilder().withL1Method('eth_call', () => ACCOUNT_DATA_L1_BATCH_HASH).build();

        const invalidAddress = '0xnothex';
        const { exitCode, stdout } = await runCli([
            'verify',
            'account-data',
            invalidAddress,
            '--block-number',
            BLOCK_NUMBER_HEX,
            '--apiUrl',
            stack.prividium.url,
            '--l1',
            stack.l1.url,
            '--diamond-address',
            DIAMOND_ADDRESS,
            '--config-path',
            stack.configPath
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`Invalid address: ${invalidAddress}`);
        expect(stack.prividium.requests).toHaveLength(0);
    }, 30_000);

    it('exits non-zero when the diamond address is not a valid hex address', async () => {
        stack = await new CliStackBuilder().withL1Method('eth_call', () => ACCOUNT_DATA_L1_BATCH_HASH).build();

        const invalidDiamond = '0xnothex';
        const { exitCode, stdout } = await runCli([
            'verify',
            'account-data',
            CONTRACT_ADDRESS,
            '--block-number',
            BLOCK_NUMBER_HEX,
            '--apiUrl',
            stack.prividium.url,
            '--l1',
            stack.l1.url,
            '--diamond-address',
            invalidDiamond,
            '--config-path',
            stack.configPath
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`Invalid diamond address: ${invalidDiamond}`);
        expect(stack.prividium.requests).toHaveLength(0);
    }, 30_000);

    it('exits non-zero when the RPC returns a proof for a different address', async () => {
        const otherAddress = '0x000000000000000000000000000000000000dead';
        stack = await new CliStackBuilder()
            .withPrividiumMethod('prividium_accountDataDisclosure', () => ({
                ...ACCOUNT_DATA_DISCLOSURE,
                address: otherAddress
            }))
            .withL1Method('eth_call', () => ACCOUNT_DATA_L1_BATCH_HASH)
            .build();

        const { exitCode, stdout } = await runCli(accountDataCliArgs(stack));

        expect(exitCode).toBe(1);
        expect(stdout).toContain('Disclosure address does not match with expected address');
        expect(stdout).toContain(getAddress(CONTRACT_ADDRESS));
        expect(stdout).toContain(getAddress(otherAddress));
    }, 30_000);
});
