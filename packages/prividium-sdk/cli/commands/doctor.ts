import { intro } from '@clack/prompts';
import type { DefCommand } from '../base-cli.js';
import { authenticationStage } from './doctor/probes/authentication.js';
import { createBridgingStage } from './doctor/probes/bridging.js';
import { globalStage } from './doctor/probes/global.js';
import { createWalletStage } from './doctor/probes/wallet.js';
import { walletApiStage } from './doctor/probes/wallet-api.js';
import { buildDoctorReport } from './doctor/report/build.js';
import { printReport } from './doctor/report/render.js';
import { executeDoctorStages } from './doctor/stages.js';
import type { DoctorContext, Options } from './doctor/types.js';
import { showPrividiumHeader } from './utils/show-prividium-header.js';
import { gatherApiUrl } from './utils/url-config.js';

async function runDoctor(opts: Options): Promise<void> {
    showPrividiumHeader();
    intro('Prividium™ Doctor');

    const prividiumRpcUrl = await gatherApiUrl({
        configPath: opts.configPath,
        apiUrl: opts.rpcUrl
    });

    const executionContext: DoctorContext = {
        rawRpcUrl: prividiumRpcUrl,
        walletAddresses: [],
        walletApiAvailable: false,
        results: []
    };

    const fixedStages = [globalStage, authenticationStage, walletApiStage];
    await executeDoctorStages(executionContext, fixedStages);

    const { walletAddresses } = executionContext;
    const dynamicStages: typeof fixedStages = [];

    if (walletAddresses.length === 0) {
        executionContext.results.push({
            id: 'wallet',
            label: `Wallet - ${[executionContext.authState ? 'No associated wallets' : 'Authentication not completed']}`,
            status: 'skip',
            section: 'Wallets'
        });
    } else {
        dynamicStages.push(
            ...walletAddresses.flatMap((addr, i) => [createWalletStage(addr, i, walletAddresses.length)])
        );
        dynamicStages.push(createBridgingStage(walletAddresses[0]!));
        await executeDoctorStages(executionContext, dynamicStages);
    }

    const report = buildDoctorReport(executionContext, [...fixedStages, ...dynamicStages]);
    printReport(report);

    if (report.status === 'fail') {
        process.exitCode = 1;
    }
}

export const addDoctor: DefCommand = (cli) => {
    return cli.command(
        'doctor',
        'Runs Prividium Doctor checks',
        (yargs) =>
            yargs
                .option('rpcUrl', {
                    alias: ['prividium-api-url', 'rpc-url', 'r'],
                    description:
                        'Target Prividium™ API URL or /rpc URL. The User Panel url and chain config are fetched from /.well-known/prividium on this host.',
                    demandOption: false,
                    type: 'string'
                })
                .option('userPanelUrl', {
                    alias: ['user-panel-url', 'u'],
                    description:
                        'Specifies the User Panel url to check. When provided, this value takes priority and the User Panel url is not fetched from /.well-known/prividium.',
                    demandOption: false,
                    deprecated: 'fetched automatically from Prividium™ API.',
                    type: 'string'
                }),
        async (args) => {
            try {
                await runDoctor({
                    rpcUrl: args.rpcUrl,
                    userPanelUrl: args.userPanelUrl,
                    configPath: args.configPath
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`Prividium doctor failed: ${message}`);
                process.exit(1);
            }
        }
    );
};
