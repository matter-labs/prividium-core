import { createBaseCli, type DefCommand } from './base-cli.js';
import { addConfig } from './commands/config.js';
import { addDoctor } from './commands/doctor.js';
import { addProxy } from './commands/proxy.js';
import { addVerify } from './commands/verify.js';

const actions: DefCommand[] = [addProxy, addDoctor, addConfig, addVerify];

export function buildCli() {
    const base = createBaseCli();
    const composed = actions.reduce((argv, applyAction) => applyAction(argv), base);
    return composed.help().strict().demandCommand();
}
