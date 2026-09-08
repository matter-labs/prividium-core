import { DEFAULT_DOCTOR_CALLBACK_PORT } from '../constants.js';
import type { DoctorStageDefinition } from '../types.js';
import { passed } from '../utils.js';
import {
    runBrowserAuthProbe,
    runProfileFetchProbe,
    runSessionValidationProbe
} from './authentication/authentication.js';
import { runWalletPreconditionsProbe } from './authentication/wallet-preconditions.js';

export const authenticationStage: DoctorStageDefinition = {
    id: 'authentication',
    title: 'Authentication',
    getProbes: () => [
        {
            id: 'browser-authentication',
            label: 'Browser authentication',
            progressMessage: `Complete sign-in in the browser. If needed, open http://localhost:${DEFAULT_DOCTOR_CALLBACK_PORT}/`,
            runIf: passed(
                ['user-panel-reachable', 'User Panel not reachable'],
                ['api-health', 'API not reachable'],
                ['callback-port-available', 'Callback port not available']
            ),
            run: runBrowserAuthProbe
        },
        {
            id: 'session-validation',
            label: 'Session validation',
            runIf: passed('browser-authentication', 'Browser authentication failed'),
            run: runSessionValidationProbe
        },
        {
            id: 'profile-fetch',
            label: 'Profile fetch',
            runIf: passed('session-validation', 'Session validation failed'),
            run: runProfileFetchProbe
        },
        {
            id: 'wallet-preconditions',
            label: 'Wallet preconditions',
            runIf: passed('profile-fetch', 'Profile not available'),
            run: runWalletPreconditionsProbe
        }
    ]
};
