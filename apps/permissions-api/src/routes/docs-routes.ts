import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyServer } from '../build-app';
import type { Repositories } from '../db';
import type { SessionService as SessionServiceType } from '../services/session-service';
import { SessionService } from '../services/session-service';
import { applyDocsSecurityHeaders } from '../utils/docs-security-headers';
import { DOCS_SESSION_COOKIE_NAME } from '../utils/docs-session';
import { InvalidInputError, UnauthorizedError } from '../utils/error-types';
import { selfOriginFromRequest } from '../utils/self-origin';
import { EstablishSessionBodySchema } from './schemas/docs';

// docs auth: /docs/login -> user-panel authorize -> /docs/callback#token -> POST /docs/session mints a docs-scoped cookie
export interface DocsRoutesDeps {
    repos: Repositories;
    sessionService: SessionServiceType;
    allowedRoles: string[];
    userPanelUrl: string;
}

const OAUTH_CLIENT_ID = 'swagger-docs';

const SESSION_COOKIE_OPTIONS: CookieSerializeOptions = {
    httpOnly: true,
    path: '/docs',
    sameSite: 'strict'
};

export function docsRoutes(server: FastifyServer, deps: DocsRoutesDeps) {
    server.get('/docs/login', async (request, reply) => {
        const redirectUri = `${selfOriginFromRequest(request)}/docs/callback`;

        const authorizeUrl = new URL('/auth/authorize', deps.userPanelUrl);
        authorizeUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('response_type', 'token');
        // state is required by user-panel but not bound/verified here
        authorizeUrl.searchParams.set('state', 'docs');

        return reply.redirect(authorizeUrl.toString());
    });

    server.get('/docs/callback', async (_request, reply) => {
        // token lives in the URL fragment; this shim reads it client-side and POSTs to /docs/session
        applyDocsSecurityHeaders(reply);
        return reply.type('text/html; charset=utf-8').send(CALLBACK_SHIM_HTML);
    });

    server.post('/docs/session', async (request, reply) => {
        const parsed = EstablishSessionBodySchema.safeParse(request.body);
        if (!parsed.success) {
            throw new InvalidInputError('Invalid request body');
        }
        const { token } = parsed.data;

        const tokenHash = SessionService.hashToken(token);
        const incomingSession = await deps.repos.sessions.findActiveByTokenHash(tokenHash);
        if (!incomingSession?.userId) {
            throw new UnauthorizedError('Invalid session');
        }
        if (incomingSession.scope !== null) {
            throw new UnauthorizedError('Invalid session');
        }

        const user = await deps.repos.users.findByIdWithRoles(incomingSession.userId);
        if (!user) {
            throw new UnauthorizedError('Invalid session');
        }

        // Matched by role id: SWAGGER_UI_ALLOWED_ROLES lists role ids, and the built-in zone admin role
        // has the stable id "admin", so an operator can allow it with a fixed, cross-environment value.
        const userRoleIds = new Set(user.roles.map((r) => r.id));
        const hasAllowedRole = deps.allowedRoles.some((r) => userRoleIds.has(r));
        if (!hasAllowedRole) {
            request.log.debug(
                {
                    userId: user.id,
                    userRoles: [...userRoleIds],
                    allowedRoles: deps.allowedRoles
                },
                'docs.session.role_denied'
            );
            reply.code(403);
            return { error: 'forbidden' };
        }

        const docsSession = await deps.sessionService.createDocsSession({
            userId: user.id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent']
        });

        reply.setCookie(DOCS_SESSION_COOKIE_NAME, docsSession.token, {
            ...SESSION_COOKIE_OPTIONS,
            maxAge: Math.max(Math.floor((docsSession.expiresAt.getTime() - Date.now()) / 1000), 0)
        });

        reply.code(204);
        return null;
    });
}

const CALLBACK_SHIM_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Signing you in…</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
</head><body>
<p id="status">Signing you in…</p>
<script>
(async function () {
    var status = document.getElementById('status');
    try {
        var hash = new URLSearchParams(window.location.hash.slice(1));
        var token = hash.get('token');
        try { window.history.replaceState(null, '', '/docs/callback'); } catch (_) {}
        if (!token) {
            status.textContent = 'Auth failed: missing token.';
            return;
        }
        var res = await fetch('/docs/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ token: token })
        });
        if (!res.ok) {
            status.textContent = 'Auth failed: ' + res.status;
            return;
        }
        window.location.replace('/docs');
    } catch (e) {
        status.textContent = 'Auth failed.';
    }
})();
</script>
</body></html>
`;
