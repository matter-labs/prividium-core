import { setTimeout } from 'node:timers/promises';
import { confirm, intro, isCancel, log, outro, spinner } from '@clack/prompts';
import { showPrividiumHeader } from '../utils/show-prividium-header.js';

export class VerifyWorkflow {
    start() {
        showPrividiumHeader();
        intro('Starting Prividium™ verification tool');
    }

    async step<T>(waitMsg: string, successMessage: string, task: () => Promise<T>): Promise<T> {
        const spin = spinner({
            indicator: 'dots'
        });

        spin.start(waitMsg);
        const [res] = await Promise.all([task(), setTimeout(1500)]).catch((e) => {
            spin.stop(`❌ ${waitMsg}`);
            throw e;
        });

        spin.stop(successMessage);

        return res;
    }

    success(msg: string) {
        outro(msg);
    }

    error(msg: string) {
        log.error(msg);
        outro('❌ error');
    }

    message(msg: string) {
        log.message(msg);
    }

    async userConfirmation(msg: string): Promise<boolean> {
        const res = await confirm({
            message: msg,
            initialValue: true
        });

        if (isCancel(res)) {
            return false;
        }

        return res;
    }
}
