import type { BaseCli, DefCommand } from '../base-cli.js';
import { addVerifyAccountDataCmd } from './verify/account-data-cmd.js';
import { addErc20BalanceCmd } from './verify/erc20-balance-cmd.js';
import { addErc20SupplyCmd } from './verify/erc20-supply-cmd.js';

function addVerifyOptions(cli: BaseCli) {
    return cli
        .option('l1Rpc', {
            alias: ['l1-rpc', 'l1'],
            description: 'Url for l1 rpc',
            demandOption: false,
            type: 'string'
        })
        .option('zkSyncOsRpc', {
            alias: ['zksync-os-rpc', 'zksync-os'],
            description:
                'ZKsync OS RPC used to replay the disclosed EVM call locally with proof-derived state overrides. Does not need historical state — a freshly started node works.',
            demandOption: false,
            type: 'string'
        })
        .option('apiUrl', {
            alias: ['api-url', 'rpc-url', 'r', 'prividium-rpc', 'prividium'],
            description: 'Specifies target Prividium™ API url',
            demandOption: false,
            type: 'string'
        })
        .option('blockNumber', {
            alias: ['block-number', 'height'],
            description: 'block number in hex',
            demandOption: true,
            type: 'string'
        })
        .option('diamondAddress', {
            alias: ['diamond-address'],
            description: 'Address for the diamond in l1',
            type: 'string'
        });
}

export type VerifyCli = ReturnType<typeof addVerifyOptions>;
export type VerifyDefCommand = (args: VerifyCli) => VerifyCli;

export const addVerify: DefCommand = (cli) => {
    return cli
        .command('verify', 'Verify proofs of data from a prividium chain', (cli) => {
            const withVerifyOpts = addVerifyOptions(cli);
            return [addErc20SupplyCmd, addErc20BalanceCmd, addVerifyAccountDataCmd].reduce(
                (a, b) => b(a),
                withVerifyOpts
            );
        })
        .demandCommand();
};
