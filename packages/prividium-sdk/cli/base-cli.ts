import yargs from 'yargs';

export function createBaseCli() {
    return yargs()
        .scriptName('prividium-cli')
        .option('configPath', {
            alias: ['c', 'config-path', 'config'],
            description: 'Path for config file. By default config file is stored under user personal folder',
            type: 'string',
            demandOption: false
        });
}

export type BaseCli = ReturnType<typeof createBaseCli>;
export type DefCommand = (args: BaseCli) => BaseCli;
