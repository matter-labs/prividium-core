import { spinner } from '@clack/prompts';
import type { DoctorContext, DoctorStageDefinition } from './types.js';
import { getThrownReason } from './utils.js';

export async function executeDoctorStages(context: DoctorContext, stages: DoctorStageDefinition[]): Promise<void> {
    for (const stage of stages) {
        await runStage(context, stage);
    }
}

async function runStage(context: DoctorContext, stage: DoctorStageDefinition): Promise<void> {
    const progress = spinner();
    progress.start(`${stage.title} started`);

    for (const probe of stage.getProbes(context)) {
        if (probe.progressMessage) {
            progress.message(probe.progressMessage);
        }

        const shouldRun = probe.runIf?.(context) ?? { run: true };
        if (!shouldRun.run) {
            context.results.push({
                id: probe.id,
                label: `${probe.label} - ${shouldRun.reason}`,
                status: 'skip',
                section: stage.id
            });
            continue;
        }

        if (!probe.run) {
            throw new Error(`Probe "${probe.id}" is missing a run handler`);
        }

        try {
            const output = await probe.run(context);
            context.results.push({
                id: probe.id,
                label: probe.label,
                status: output?.status ?? 'pass',
                details: output?.details,
                values: output?.values,
                section: stage.id
            });
        } catch (error) {
            context.results.push({
                id: probe.id,
                label: probe.label,
                status: 'fail',
                details: [getThrownReason(error)],
                section: stage.id
            });
        }
    }

    progress.stop(`${stage.title} completed`);
}
