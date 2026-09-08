import type { DoctorContext, ProbeOutput } from '../../types.js';
import { validateAndNormalizeUrls } from '../../utils.js';

export async function runInputValidationProbe(context: DoctorContext) {
    context.targets = validateAndNormalizeUrls(context.rawRpcUrl);
}

export async function runHostMismatchProbe(context: DoctorContext): Promise<ProbeOutput | undefined> {
    const warnings = [];

    if (new URL(context.targets!.apiBaseUrl).origin !== new URL(context.rawRpcUrl).origin) {
        warnings.push({ label: 'api', value: context.rawRpcUrl });
    }

    if (context.targets!.userPanelBaseUrl !== context.rawUserPanelUrl) {
        warnings.push({ label: 'user panel', value: context.rawUserPanelUrl ?? '' });
    }

    if (warnings.length > 0) {
        return {
            status: 'warn',
            values: warnings
        };
    }
}
