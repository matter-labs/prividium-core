import { createPublicClient, getAddress, type Hex, http } from 'viem';
import { selectiveDisclosureActions, verifyAccountPropertiesProof } from '#sdk';
import { ConfigFile } from '../../server/config-file.js';
import { addressSchema } from '../utils/schemas.js';
import type { VerifyDefCommand } from '../verify.js';
import { parseBlockNumber } from './utils.js';
import { VerifyWorkflow } from './verify-workflow.js';

type Opts = {
    address: string;
    l1Rpc?: string;
    apiUrl?: string;
    blockNumber: string;
    diamondAddress?: string;
    configPath?: string;
    expectedBytecode?: string;
    verbose: boolean;
};

export async function verifyAccountData(opts: Opts): Promise<void> {
    const wf = new VerifyWorkflow();
    const configFile = new ConfigFile(opts.configPath);
    wf.start();

    const givenAddressParsed = addressSchema.safeParse(opts.address);
    if (!givenAddressParsed.success) {
        wf.error(`Invalid address: ${opts.address}`);
        process.exit(1);
    }

    if (opts.diamondAddress && !addressSchema.safeParse(opts.diamondAddress).success) {
        wf.error(`Invalid diamond address: ${opts.diamondAddress}`);
        process.exit(1);
    }

    const givenAddress = getAddress(givenAddressParsed.data);

    try {
        const { l1RpcUrl, diamondAddress, apiUrl } = await configFile.readAndUpdatedRequiredFields({
            apiUrl: opts.apiUrl,
            l1RpcUrl: opts.l1Rpc,
            diamondAddress: opts.diamondAddress
        });
        const prividiumRpcUrl = new URL('/rpc', apiUrl).toString();

        const l1Client = createPublicClient({ transport: http(l1RpcUrl) });
        const prividiumRpc = createPublicClient({ transport: http(prividiumRpcUrl) }).extend(
            selectiveDisclosureActions
        );

        const disclosure = await wf
            .step('Gathering proofs', 'Proofs received ✅', () =>
                prividiumRpc.accountDataDisclosure(givenAddress, parseBlockNumber(opts.blockNumber))
            )
            .catch((e) => {
                const detail = e instanceof Error ? e.message : 'unexpected error';
                wf.error(`Error fetching proofs: ${detail}`);
                process.exit(1);
            });

        if (opts.verbose) {
            wf.message(JSON.stringify(disclosure, null, 2));
        }

        const expectedBytecode = opts.expectedBytecode ? (opts.expectedBytecode as Hex) : undefined;

        const res = await wf
            .step('Verifying proofs', 'Proofs verified ✅', () =>
                verifyAccountPropertiesProof(
                    disclosure,
                    l1Client,
                    getAddress(diamondAddress),
                    expectedBytecode,
                    givenAddress
                )
            )
            .catch((e) => {
                const detail = e instanceof Error ? e.message : 'unexpected error';
                wf.error(`Unexpected error verifying proofs: ${detail}`);
                process.exit(1);
            });

        if (res.success) {
            [
                `Address: ${getAddress(disclosure.address)}`,
                `Balance: ${disclosure.accountProperties.balance}`,
                `Nonce: ${disclosure.accountProperties.nonce}`,
                `Bytecode: ${disclosure.bytecode}`
            ].forEach((msg) => {
                wf.message(msg);
            });
            wf.success('Ok!');
        } else {
            wf.error(`Verification failed: ${res.errorMsg}`);
            process.exit(1);
        }
    } catch (e) {
        if (typeof e === 'object' && e && 'message' in e && typeof e.message === 'string') {
            wf.error(e.message);
        } else {
            wf.error('Unexpected error');
        }
        process.exit(1);
    }
}

export const addVerifyAccountDataCmd: VerifyDefCommand = (cli) =>
    cli.command(
        'account-data <address>',
        'Verify account data (balance, nonce, bytecode) using proofs from L1',
        (yargs) =>
            yargs
                .positional('address', {
                    description: 'Address of the account to verify',
                    type: 'string',
                    demandOption: true
                })
                .option('expectedBytecode', {
                    alias: ['expected-bytecode', 'bytecode'],
                    description:
                        'Expected contract bytecode (hex). When provided, the verifier checks that the disclosed bytecode hash matches this value.',
                    demandOption: false,
                    type: 'string'
                })
                .option('verbose', {
                    alias: ['v'],
                    description: 'Verbose',
                    type: 'boolean',
                    default: false
                }),
        async (yargs) => {
            await verifyAccountData({
                address: yargs.address,
                l1Rpc: yargs.l1Rpc,
                apiUrl: yargs.apiUrl,
                blockNumber: yargs.blockNumber,
                diamondAddress: yargs.diamondAddress,
                configPath: yargs.configPath,
                expectedBytecode: yargs.expectedBytecode,
                verbose: yargs.verbose
            });
        }
    );
