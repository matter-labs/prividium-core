import { fetchPrividiumConfig } from '#sdk';
import type { DoctorContext, ProbeOutput } from '../../types.js';

export async function runWellKnownProbe(context: DoctorContext): Promise<ProbeOutput> {
    const prividiumInfo = await fetchPrividiumConfig(new URL(context.targets!.apiBaseUrl).origin);

    context.targets = {
        ...context.targets!,
        userPanelBaseUrl: new URL(prividiumInfo.userPanelUrl).origin
    };
    context.apiVersion = prividiumInfo.version;

    return {
        values: [
            { label: 'User Panel', value: prividiumInfo.userPanelUrl, inline: true },
            { label: 'Chain', value: prividiumInfo.chainName, inline: true },
            { label: 'Version', value: prividiumInfo.version, inline: true }
        ]
    };
}
