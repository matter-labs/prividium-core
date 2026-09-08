import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { Repositories } from '../db';
import type { InsertSession } from '../repositories/sessions-repository';
import { UnauthorizedError } from '../utils/error-types';

export interface SessionServiceOpts {
    userSessionDurationSeconds: number;
    tenantSessionDurationSeconds: number;
    serviceSessionDurationSeconds: number;
    /** When set, user sessions use a sliding idle deadline (expiresAt = now + idle). Unset = feature OFF. */
    userIdleTimeoutSeconds?: number;
}

export interface CreatedSession {
    /** Plaintext token returned to the client; only the hash is persisted in the database. */
    token: string;
    expiresAt: Date;
    /** Equals expiresAt when the idle timeout is off. */
    renewableUntil: Date;
}

export interface ExtendedSession {
    expiresAt: Date;
    renewableUntil: Date;
    /** False when the deadline did not move — the caller uses this to keep no-ops out of the audit log. */
    extended: boolean;
}

export class SessionService {
    private repos: Repositories;
    private opts: SessionServiceOpts;

    constructor({ repos, opts }: { repos: Repositories; opts: SessionServiceOpts }) {
        this.repos = repos;
        this.opts = opts;
    }

    async createUserSession(
        data: Omit<InsertSession, 'tokenHash' | 'expiresAt' | 'tenantId' | 'serviceId'>
    ): Promise<CreatedSession> {
        return this.createSession(data, {
            durationSeconds: this.opts.userSessionDurationSeconds,
            idleTimeoutSeconds: this.opts.userIdleTimeoutSeconds
        });
    }

    async createTenantSession(
        data: Omit<InsertSession, 'tokenHash' | 'expiresAt' | 'userId' | 'serviceId'>
    ): Promise<CreatedSession> {
        return this.createSession(data, { durationSeconds: this.opts.tenantSessionDurationSeconds });
    }

    async createServiceSession(
        data: Omit<InsertSession, 'tokenHash' | 'expiresAt' | 'userId' | 'tenantId'>
    ): Promise<CreatedSession> {
        return this.createSession(data, { durationSeconds: this.opts.serviceSessionDurationSeconds });
    }

    /**
     * Creates a user session limited to the `/docs` scope. Tokens from these sessions are
     * rejected by `SessionsAuthValidator` on non-`/docs` paths, so a leak cannot be used to
     * access the rest of the API.
     *
     * Docs sessions intentionally do NOT apply idle sliding: they are short-lived scoped
     * tokens used exclusively to gate the Swagger UI, and extending their lifetime on activity
     * would add complexity for no user-visible benefit. expiresAt == renewableUntil == cap.
     */
    async createDocsSession(
        data: Omit<InsertSession, 'tokenHash' | 'expiresAt' | 'tenantId' | 'serviceId' | 'scope'>
    ): Promise<CreatedSession> {
        return this.createSession(
            { ...data, scope: 'docs' },
            { durationSeconds: this.opts.userSessionDurationSeconds }
        );
    }

    async extendSession(tokenHash: string): Promise<ExtendedSession> {
        const session = await this.repos.sessions.findActiveByTokenHash(tokenHash);
        if (!session) {
            // No active session for this token (expired or revoked). The session-auth hook
            // already 401s before we reach here in practice; throwing keeps that contract for
            // direct service calls rather than returning a misleading 200 with epoch-0 dates.
            throw new UnauthorizedError('Session not found or no longer active');
        }

        const renewableUntil = session.renewableUntil ?? session.expiresAt;

        // Only slide the idle deadline for USER sessions when idle timeout is enabled.
        // Tenant and service sessions are fixed-duration (expiresAt == renewableUntil at
        // creation); sliding would shorten them to the user idle window.
        const isUserSession = session.userId !== null;
        if (this.opts.userIdleTimeoutSeconds === undefined || !isUserSession) {
            return { expiresAt: session.expiresAt, renewableUntil, extended: false };
        }

        // Slide expiresAt forward, but never past the renewableUntil cap.
        const now = Date.now();
        const slid = new Date(now + this.opts.userIdleTimeoutSeconds * 1000);
        const newExpiresAt = slid < renewableUntil ? slid : renewableUntil;

        // At the cap the write would set expiresAt to what it already is. Skipping it keeps the
        // 5-minutely extend loop from filling the audit trail with rows that changed nothing.
        if (newExpiresAt.getTime() === session.expiresAt.getTime()) {
            return { expiresAt: session.expiresAt, renewableUntil, extended: false };
        }

        const updated = await this.repos.sessions.extendByTokenHash(tokenHash, newExpiresAt);
        // If the update matched nothing (race — session expired between findActive and update),
        // return the pre-read unchanged deadlines. Returning the computed newExpiresAt would
        // falsely tell the client the session was extended. The hook will 401 on the next request.
        return {
            expiresAt: updated?.expiresAt ?? session.expiresAt,
            renewableUntil: updated ? (updated.renewableUntil ?? updated.expiresAt) : renewableUntil,
            extended: updated !== undefined
        };
    }

    async deleteSession(tokenHash: string) {
        return this.repos.sessions.deleteByTokenHash(tokenHash);
    }

    static hashToken(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private async createSession(
        data: Omit<InsertSession, 'tokenHash' | 'expiresAt' | 'renewableUntil'>,
        { durationSeconds, idleTimeoutSeconds }: { durationSeconds: number; idleTimeoutSeconds?: number }
    ): Promise<CreatedSession> {
        const token = this.generateSessionToken();
        const tokenHash = SessionService.hashToken(token);
        const now = Date.now();
        const renewableUntil = new Date(now + durationSeconds * 1000);
        // expiresAt is the idle deadline when idle timeout is set, otherwise equals the cap.
        const expiresAt = idleTimeoutSeconds !== undefined ? new Date(now + idleTimeoutSeconds * 1000) : renewableUntil;
        const session = await this.repos.sessions.create({
            ...data,
            tokenHash,
            expiresAt,
            renewableUntil
        });
        return {
            token,
            expiresAt: session.expiresAt,
            renewableUntil: session.renewableUntil ?? session.expiresAt
        };
    }

    private generateSessionToken() {
        return nanoid();
    }
}
