import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { it as dbIt } from '../../test/unit-test-context';
import { type DB, Repositories } from '../db';
import { auditLogsTable } from '../db/schema';
import { AuditLogsService, fakeAuditLogContextForTests } from '../services/audit-logs-service';
import { featureAuditContextOf } from './core-request-auth';

describe('featureAuditContextOf', () => {
    function requestWithAuditContext() {
        const logSecurityEvent = vi.fn().mockResolvedValue(undefined);
        const request = { auditContext: { logSecurityEvent } } as unknown as FastifyRequest;
        return { request, logSecurityEvent };
    }

    it('writes an event handed a connection on that connection, so it joins its open transaction', async () => {
        const { request, logSecurityEvent } = requestWithAuditContext();
        const client = { query: vi.fn() } as unknown as PoolClient;

        await featureAuditContextOf(request).logSecurityEvent('feature.change', 'feature-item', 'item-1', {}, client);

        expect(logSecurityEvent).toHaveBeenCalledOnce();
        const [action, entityType, entityId, , db] = logSecurityEvent.mock.calls[0]!;
        expect([action, entityType, entityId]).toEqual(['feature.change', 'feature-item', 'item-1']);
        expect(db.$client).toBe(client);
    });

    it('leaves an event without a connection to the audit service, as before', async () => {
        const { request, logSecurityEvent } = requestWithAuditContext();

        await featureAuditContextOf(request).logSecurityEvent('feature.change', 'feature-item', undefined, {
            reason: 'x'
        });

        expect(logSecurityEvent).toHaveBeenCalledWith(
            'feature.change',
            'feature-item',
            undefined,
            { reason: 'x' },
            undefined
        );
    });
});

describe('featureAuditContextOf on a database', () => {
    async function logInTransaction(db: DB, requestId: string, end: 'COMMIT' | 'ROLLBACK') {
        const auditContext = fakeAuditLogContextForTests(new AuditLogsService(new Repositories(db)), { requestId });
        const request = { auditContext } as unknown as FastifyRequest;
        const client = await db.$client.connect();
        try {
            await client.query('BEGIN');
            await featureAuditContextOf(request).logSecurityEvent(
                'feature.change',
                'feature-item',
                'item-1',
                {},
                client
            );
            await client.query(end);
        } finally {
            client.release();
        }
    }

    const eventsOf = (db: DB, requestId: string) =>
        db.select().from(auditLogsTable).where(eq(auditLogsTable.requestId, requestId));

    dbIt('leaves no event behind when the transaction rolls back', async ({ db }) => {
        await logInTransaction(db, 'rolled-back', 'ROLLBACK');
        expect(await eventsOf(db, 'rolled-back')).toEqual([]);
    });

    dbIt('keeps the event when the transaction commits', async ({ db }) => {
        await logInTransaction(db, 'committed', 'COMMIT');
        expect(await eventsOf(db, 'committed')).toHaveLength(1);
    });
});
