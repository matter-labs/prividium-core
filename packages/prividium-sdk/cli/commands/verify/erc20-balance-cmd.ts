import { createPublicClient, getAddress, hexToBigInt, http } from 'viem';
import { selectiveDisclosureActions, verifyEthCallDisclosure } from '#sdk';
import { ConfigFile } from '../../server/config-file.js';
import type { VerifyDefCommand } from '../verify.js';
import { loadBytecodes, parseBlockNumber } from './utils.js';
import { VerifyWorkflow } from './verify-workflow.js';

type Opts = {
    tokenAddr: string;
    holderAddr: string;
    l1Rpc?: string;
    zkSyncOsRpc?: string;
    apiUrl?: string;
    blockNumber: string;
    diamondAddress?: string;
    bytecodesFile?: string;
    bytecodes: string[];
    configPath?: string;
    verbose: boolean;
};

export async function erc20BalanceCmd(opts: Opts): Promise<void> {
    const wf = new VerifyWorkflow();
    const configFile = new ConfigFile(opts.configPath);

    wf.start();
    try {
        const bytecodes = loadBytecodes(opts.bytecodesFile, opts.bytecodes);

        const { apiUrl, l1RpcUrl, localZksyncOsRpcUrl, diamondAddress } = await configFile.readAndUpdatedRequiredFields(
            {
                apiUrl: opts.apiUrl,
                l1RpcUrl: opts.l1Rpc,
                localZksyncOsRpcUrl: opts.zkSyncOsRpc,
                diamondAddress: opts.diamondAddress
            }
        );
        const l2RpcUrl = localZksyncOsRpcUrl;
        const prividiumRpcUrl = new URL('/rpc', apiUrl).toString();

        const checkedTokenAddr = getAddress(opts.tokenAddr);
        const checkedHolderAddr = getAddress(opts.holderAddr);

        const l1Client = createPublicClient({ transport: http(l1RpcUrl) });
        const l2Client = createPublicClient({ transport: http(l2RpcUrl) });
        const prividiumRpc = createPublicClient({ transport: http(prividiumRpcUrl) }).extend(
            selectiveDisclosureActions
        );

        const disclosure = await wf
            .step('Gathering proofs', 'Proofs fetched ✅', () =>
                prividiumRpc.tokenBalanceDisclosure(
                    checkedTokenAddr,
                    checkedHolderAddr,
                    parseBlockNumber(opts.blockNumber)
                )
            )
            .catch((e) => {
                const detail = e instanceof Error ? e.message : 'unexpected error';
                wf.error(`Error fetching proofs: ${detail}`);
                process.exit(1);
            });

        if (opts.verbose) {
            wf.message(JSON.stringify(disclosure, null, 2));
        }

        const res = await wf
            .step('Verifying proofs', 'Proofs verified ✅', () =>
                verifyEthCallDisclosure({
                    disclosure,
                    l1Client,
                    l2Client,
                    diamondAddress: getAddress(diamondAddress),
                    contractBytecodes: bytecodes,
                    batchNumber: disclosure.batchNumber
                })
            )
            .catch((e) => {
                const detail = e instanceof Error ? e.message : 'unexpected error';
                wf.error(`Verification failed: ${detail}`);
                process.exit(1);
            });

        if (res.success) {
            wf.success(`Balance: ${hexToBigInt(disclosure.result)}`);
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

export const addErc20BalanceCmd: VerifyDefCommand = (cli) =>
    cli.command(
        'erc20-balance <tokenAddr> <holderAddr>',
        'Verify an ERC-20 holder balance using proofs from L1',
        (yargs) =>
            yargs
                .positional('tokenAddr', {
                    description: 'Address of the token',
                    type: 'string',
                    demandOption: true
                })
                .positional('holderAddr', {
                    description: 'Address of the token holder to check the balance',
                    type: 'string',
                    demandOption: true
                })
                .option('bytecodesFile', {
                    alias: 'bytecodes-file',
                    description:
                        'JSON file with contracts bytecodes. The file should be a simple object using the addresses as keys with the respective bytecodes as values',
                    type: 'string',
                    demandOption: false
                })
                .option('bytecodes', {
                    alias: ['address-bytecode', 'addressBytecode', 'contractBytecode', 'contract-bytecode'],
                    description:
                        "Contract bytecode in '0x<address>:0x<bytecode>' format. Repeat the flag for multiple contracts. Alternatively use --bytecodes-file to supply a JSON map.",
                    array: true,
                    demandOption: true,
                    default: [],
                    type: 'string'
                })
                .option('verbose', {
                    alias: ['v'],
                    description: 'Verbose',
                    type: 'boolean',
                    default: false
                }),
        async (yargs) => {
            await erc20BalanceCmd({
                tokenAddr: yargs.tokenAddr,
                holderAddr: yargs.holderAddr,
                blockNumber: yargs.blockNumber,
                diamondAddress: yargs.diamondAddress,
                l1Rpc: yargs.l1Rpc,
                zkSyncOsRpc: yargs.zkSyncOsRpc,
                apiUrl: yargs.apiUrl,
                bytecodesFile: yargs.bytecodesFile,
                bytecodes: yargs.bytecodes,
                configPath: yargs.configPath,
                verbose: yargs.verbose
            });
        }
    );
