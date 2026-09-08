import { setTimeout } from 'node:timers/promises';
import { intro, log, tasks } from '@clack/prompts';
import color from 'kleur';
import open from 'open';

import { showPrividiumHeader } from '../commands/utils/show-prividium-header.js';

export class CreationWorkflow {
    private submitCallback: undefined | ((s: string) => void);
    private host: string;
    private port: number;

    constructor(host: string, port: number) {
        this.submitCallback = undefined;
        this.host = host;
        this.port = port;
    }

    start() {
        showPrividiumHeader();
        intro('Starting Prividium™ proxy');
    }

    async waitForAuthentication(url: string) {
        log.info(`Please log in: ${url}`);

        // Attempt to open the browser automatically
        await this.openBrowser(url);

        await tasks([
            {
                task: async (): Promise<string> => {
                    return new Promise<string>((resolve) => {
                        this.submitCallback = resolve;
                    });
                },
                title: 'Waiting for authentication'
            }
        ]);
    }

    private async openBrowser(url: string) {
        try {
            await open(url);
        } catch (error) {
            log.warn(`Failed to automatically open browser: ${error instanceof Error ? error.message : String(error)}`);
            log.info('Please manually open the URL shown above');
        }
    }

    async onSubmit() {
        if (this.submitCallback === undefined) {
            throw new Error('Missing submit callback.');
        } else {
            this.submitCallback('Authentication successful!');
            await setTimeout(100);
        }

        log.info(`Your proxy rpc is ready! 🚀: \n\n${color.bold(`http://${this.host}:${this.port}`)}\n`);
        log.info('Waiting for logs...');
    }

    onMessage(msg: string): void {
        log.message(msg);
    }

    onError(err: Error) {
        log.error(`Error received: ${err.message}`);
    }
}
