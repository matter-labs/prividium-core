import { sessionSchema } from '../../../../server/server.js';
import { authenticateInBrowser } from '../../clients/browser-auth.js';
import { fetchAuthenticatedJson } from '../../clients/http.js';
import { DEFAULT_DOCTOR_CALLBACK_PORT } from '../../constants.js';
import { profileSchema } from '../../profile.js';
import type { DoctorContext } from '../../types.js';

export async function runBrowserAuthProbe(context: DoctorContext) {
    context.pendingToken = await authenticateInBrowser(
        context.targets!.userPanelBaseUrl!,
        DEFAULT_DOCTOR_CALLBACK_PORT
    );
}

export async function runSessionValidationProbe(context: DoctorContext) {
    context.pendingSession = await fetchAuthenticatedJson(
        sessionSchema,
        new URL('/api/auth/current-session', context.targets!.apiBaseUrl).href,
        context.pendingToken!
    );
}

export async function runProfileFetchProbe(context: DoctorContext) {
    const profile = await fetchAuthenticatedJson(
        profileSchema,
        new URL('/api/profiles/me', context.targets!.apiBaseUrl).href,
        context.pendingToken!
    );
    context.authState = { token: context.pendingToken!, session: context.pendingSession!, profile };
    context.reportContext = {
        sessionType: context.authState.session.type,
        authExpiresAt: context.authState.session.expiresAt.toISOString(),
        userDisplayName: context.authState.profile.displayName,
        userId: context.authState.profile.id,
        roles: context.authState.profile.roles.map((role) => role.roleName),
        walletCount: context.authState.profile.wallets.length
    };
    context.pendingToken = undefined;
    context.pendingSession = undefined;
}
