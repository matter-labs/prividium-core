import type { DefCommand } from '../base-cli.js';
import { type CliConfig, ConfigFile } from '../server/config-file.js';

function clearConfig(path?: string) {
    const file = new ConfigFile(path);
    file.remove();
}

function configPath(path?: string) {
    const file = new ConfigFile(path);
    file.printPath();
}

function printConfig(path?: string) {
    const file = new ConfigFile(path);
    file.print();
}

function updateConfig(urls: CliConfig, path?: string) {
    const file = new ConfigFile(path);
    file.write(urls);
}

export const addConfig: DefCommand = (cli) => {
    return cli.command('config', 'Manipulate local configuration file', (yargs) =>
        yargs
            .command(
                'clear',
                'Clears current configuration file',
                (yargs) => yargs,
                (args) => clearConfig(args.configPath)
            )
            .command(
                'path',
                'Shows local config file path',
                (yargs) => yargs,
                (args) => configPath(args.configPath)
            )
            .command(
                'print',
                'Prints current configuration',
                (yargs) => yargs,
                (args) => printConfig(args.configPath)
            )
            .command(
                'set',
                'Updates config',
                (yargs) =>
                    yargs.option('apiUrl', {
                        alias: ['api-url', 'rpc-url', 'r'],
                        description: 'Specifies target Prividium™ API url.',
                        demandOption: true,
                        type: 'string'
                    }),
                (args) =>
                    updateConfig(
                        {
                            apiUrl: args.apiUrl
                        },
                        args.configPath
                    )
            )
            .demandCommand()
    );
};
