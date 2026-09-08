import type { DoctorStageDefinition } from '../types.js';
import { passed } from '../utils.js';
import { runHostMismatchProbe, runInputValidationProbe } from './global/input-validation.js';
import {
    runApiHealthProbe,
    runCallbackPortProbe,
    runPublicRpcProbe,
    runUserPanelReachabilityProbe
} from './global/reachability.js';
import { runWellKnownProbe } from './global/well-known.js';

export const globalStage: DoctorStageDefinition = {
    id: 'global',
    title: 'Global',
    getProbes: () => [
        {
            id: 'input-validation',
            label: 'Input Validation',
            progressMessage: 'Validating input URLs',
            run: runInputValidationProbe
        },
        {
            id: 'callback-port-available',
            label: 'Callback port available',
            run: runCallbackPortProbe
        },
        {
            id: 'host-mismatch',
            label: 'Host validation',
            runIf: passed('input-validation', 'Input validation failed'),
            run: runHostMismatchProbe
        },
        {
            id: 'well-known',
            label: 'Prividium configuration',
            progressMessage: 'Fetching Prividium configuration',
            runIf: passed('input-validation', 'Input validation failed'),
            run: runWellKnownProbe
        },
        {
            id: 'user-panel-reachable',
            label: 'User Panel reachability',
            progressMessage: 'Checking User Panel reachability',
            runIf: passed('well-known', 'Could not discover User Panel url'),
            run: runUserPanelReachabilityProbe
        },
        {
            id: 'api-health',
            label: 'API health',
            progressMessage: 'Checking API health',
            runIf: passed('input-validation', 'Input validation failed'),
            run: runApiHealthProbe
        },
        {
            id: 'public-rpc',
            label: 'Public RPC',
            progressMessage: 'Checking public RPC',
            runIf: passed('input-validation', 'Input validation failed'),
            run: runPublicRpcProbe
        }
    ]
};
