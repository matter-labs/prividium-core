import type { SQL } from 'drizzle-orm';
import { and, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { z } from 'zod/v4';
import {
    auditActionTypeSchema,
    auditActorTypeSchema,
    auditLogsTable,
    auditRequestLogTable,
    dbMutationAuditLogsTable
} from '../db/schema';
import type { PaginationParams } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';

// ─── Semantic audit logs (audit_logs table) ───────────────────────────────────

export const CreateAuditLogSchema = z.object({
    activeUserId: z.string().min(1).nullable(),
    activeTenantId: z.string().nullable().optional(),
    activeServiceId: z.string().nullable().optional(),
    activeOrganizationId: z.string().nullable().optional(),
    traceId: z.string().optional(),
    requestId: z.string().optional(),
    actorType: auditActorTypeSchema.optional(),
    authSubject: z.string().nullable().optional(),
    actionType: auditActionTypeSchema,
    actionDetails: z.record(z.string(), z.any()),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional()
});

export type CreateAuditLog = z.infer<typeof CreateAuditLogSchema>;

export const SelectAuditLogSchema = z.object({
    id: z.string(),
    activeUserId: z.string().nullable(),
    activeTenantId: z.string().nullable(),
    activeServiceId: z.string().nullable(),
    activeOrganizationId: z.string().nullable().optional(),
    actionType: z.string(),
    actionDetails: z.record(z.string(), z.any()),
    traceId: z.string().nullable(),
    requestId: z.string().nullable(),
    actorType: z.string().nullable(),
    authSubject: z.string().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string()
});

export type SelectAuditLog = z.infer<typeof SelectAuditLogSchema>;

export const AuditLogsSearchCriteriaSchema = z.object({
    userId: z.string().optional(),
    activeTenantId: z.string().optional(),
    activeOrganizationId: z.string().optional(),
    actionType: auditActionTypeSchema.optional(),
    resourceId: z.string().optional(),
    requestId: z.string().optional(),
    traceId: z.string().optional(),
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional()
});

export type AuditLogsSearchCriteria = z.infer<typeof AuditLogsSearchCriteriaSchema>;

// ─── DB-level mutation audit logs (db_mutation_audit_logs + audit_request_log) ─

export const SelectDbMutationAuditLogSchema = z.object({
    id: z.string(),
    occurredAt: z.string(),
    tableName: z.string(),
    operation: z.string(),
    primaryKey: z.string().nullable(),
    oldRow: z.record(z.string(), z.any()).nullable(),
    newRow: z.record(z.string(), z.any()).nullable(),
    changedColumns: z.array(z.string()).nullable(),
    requestId: z.string().nullable(),
    jobId: z.string().nullable(),
    // Joined from audit_request_log (null when the mutation came from a background job)
    traceId: z.string().nullable(),
    actorId: z.string().nullable(),
    actorType: z.string().nullable(),
    httpOperation: z.string().nullable(),
    method: z.string().nullable(),
    url: z.string().nullable(),
    createdAt: z.string()
});

export type SelectDbMutationAuditLog = z.infer<typeof SelectDbMutationAuditLogSchema>;

export const DbMutationSearchCriteriaSchema = z.object({
    tableName: z.string().optional(),
    operation: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
    primaryKey: z.string().optional(),
    requestId: z.string().optional(),
    traceId: z.string().optional(),
    actorId: z.string().optional()
});

export type DbMutationSearchCriteria = z.infer<typeof DbMutationSearchCriteriaSchema>;

// ─── Combined audit + mutation logs ───────────────────────────────────────────

export const CombinedAuditLogsSearchCriteriaSchema = z.object({
    userId: z.string().optional(),
    actionType: auditActionTypeSchema.optional(),
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional()
});

export type CombinedAuditLogsSearchCriteria = z.infer<typeof CombinedAuditLogsSearchCriteriaSchema>;

export const SelectUnifiedAuditLogSchema = z.discriminatedUnion('logType', [
    SelectAuditLogSchema.extend({ logType: z.literal('audit') }),
    SelectDbMutationAuditLogSchema.extend({ logType: z.literal('db_mutation') })
]);

export type SelectUnifiedAuditLog = z.infer<typeof SelectUnifiedAuditLogSchema>;

// ─── Unified repository ───────────────────────────────────────────────────────

export class AuditLogsRepository extends BaseRepository {
    // ── Semantic audit logs ──────────────────────────────────────────────────

    async create(data: CreateAuditLog): Promise<SelectAuditLog> {
        const [auditLog] = await this.db.insert(auditLogsTable).values(data).returning();

        if (!auditLog) {
            throw new Error('Failed to create audit log');
        }

        return {
            ...auditLog,
            createdAt: auditLog.createdAt.toISOString()
        } as SelectAuditLog;
    }

    // `maxItems` bounds the row count at the cap instead of scanning the entire table
    async findPaginated(criteria: AuditLogsSearchCriteria, { limit, offset }: PaginationParams, maxItems?: number) {
        const {
            userId,
            activeTenantId,
            activeOrganizationId,
            actionType,
            resourceId,
            requestId,
            traceId,
            startDate,
            endDate
        } = criteria;

        const conditions = [];
        if (userId) {
            conditions.push(eq(auditLogsTable.activeUserId, userId));
        }
        if (activeTenantId) {
            conditions.push(eq(auditLogsTable.activeTenantId, activeTenantId));
        }
        conditions.push(
            activeOrganizationId !== undefined
                ? eq(auditLogsTable.activeOrganizationId, activeOrganizationId)
                : isNull(auditLogsTable.activeOrganizationId)
        );
        if (actionType) {
            conditions.push(eq(auditLogsTable.actionType, actionType));
        }
        if (resourceId) {
            conditions.push(sql`(action_details->>'resourceId') = ${resourceId}`);
        }
        if (requestId) {
            conditions.push(eq(auditLogsTable.requestId, requestId));
        }
        if (traceId) {
            conditions.push(eq(auditLogsTable.traceId, traceId));
        }
        if (startDate) {
            conditions.push(gte(auditLogsTable.createdAt, new Date(startDate)));
        }
        if (endDate) {
            conditions.push(lte(auditLogsTable.createdAt, new Date(endDate)));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const totalCount = await this.countMatching(whereClause, maxItems);

        const items = await this.db
            .select({
                id: auditLogsTable.id,
                activeUserId: auditLogsTable.activeUserId,
                activeTenantId: auditLogsTable.activeTenantId,
                activeServiceId: auditLogsTable.activeServiceId,
                activeOrganizationId: auditLogsTable.activeOrganizationId,
                actionType: auditLogsTable.actionType,
                actionDetails: auditLogsTable.actionDetails,
                traceId: auditLogsTable.traceId,
                requestId: auditLogsTable.requestId,
                actorType: auditLogsTable.actorType,
                authSubject: auditLogsTable.authSubject,
                ipAddress: auditLogsTable.ipAddress,
                userAgent: auditLogsTable.userAgent,
                createdAt: auditLogsTable.createdAt
            })
            .from(auditLogsTable)
            .where(whereClause)
            .orderBy(desc(auditLogsTable.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            items: items.map((item) => ({
                ...item,
                actionDetails: item.actionDetails as Record<string, unknown>,
                createdAt: item.createdAt.toISOString()
            })) as SelectAuditLog[],
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit),
                totalItems: totalCount,
                limit,
                offset
            }
        };
    }

    private async countMatching(whereClause: SQL | undefined, maxItems?: number): Promise<number> {
        if (maxItems === undefined) {
            const [row] = await this.db.select({ count: count() }).from(auditLogsTable).where(whereClause);
            return row?.count ?? 0;
        }

        const bounded = this.db
            .select({ matched: sql`true` })
            .from(auditLogsTable)
            .where(whereClause)
            .limit(maxItems)
            .as('bounded');
        const [row] = await this.db.select({ count: count() }).from(bounded);
        return row?.count ?? 0;
    }

    // ── DB-level mutation audit logs ─────────────────────────────────────────

    async findMutationsPaginated(
        criteria: DbMutationSearchCriteria,
        { limit, offset }: PaginationParams,
        extraConditions: SQL[] = []
    ) {
        const { tableName, operation, primaryKey, requestId, traceId, actorId } = criteria;

        const conditions: SQL[] = [];
        if (tableName) {
            conditions.push(eq(dbMutationAuditLogsTable.tableName, tableName));
        }
        if (operation) {
            conditions.push(eq(dbMutationAuditLogsTable.operation, operation));
        }
        if (primaryKey) {
            conditions.push(eq(dbMutationAuditLogsTable.primaryKey, primaryKey));
        }
        if (requestId) {
            conditions.push(eq(dbMutationAuditLogsTable.requestId, requestId));
        }
        if (traceId) {
            conditions.push(eq(auditRequestLogTable.traceId, traceId));
        }
        if (actorId) {
            conditions.push(eq(auditRequestLogTable.actorId, actorId));
        }

        conditions.push(...extraConditions);
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const baseQuery = this.db
            .select({
                id: dbMutationAuditLogsTable.id,
                occurredAt: dbMutationAuditLogsTable.occurredAt,
                tableName: dbMutationAuditLogsTable.tableName,
                operation: dbMutationAuditLogsTable.operation,
                primaryKey: dbMutationAuditLogsTable.primaryKey,
                oldRow: dbMutationAuditLogsTable.oldRow,
                newRow: dbMutationAuditLogsTable.newRow,
                changedColumns: dbMutationAuditLogsTable.changedColumns,
                requestId: dbMutationAuditLogsTable.requestId,
                jobId: dbMutationAuditLogsTable.jobId,
                createdAt: dbMutationAuditLogsTable.occurredAt,
                traceId: auditRequestLogTable.traceId,
                actorId: auditRequestLogTable.actorId,
                actorType: auditRequestLogTable.actorType,
                httpOperation: auditRequestLogTable.operation,
                method: auditRequestLogTable.method,
                url: auditRequestLogTable.url
            })
            .from(dbMutationAuditLogsTable)
            .leftJoin(auditRequestLogTable, eq(dbMutationAuditLogsTable.requestId, auditRequestLogTable.requestId));

        const countResult = await this.db
            .select({ count: count() })
            .from(dbMutationAuditLogsTable)
            .leftJoin(auditRequestLogTable, eq(dbMutationAuditLogsTable.requestId, auditRequestLogTable.requestId))
            .where(whereClause);

        const totalCount = countResult[0]?.count ?? 0;

        const items = await baseQuery
            .where(whereClause)
            .orderBy(desc(dbMutationAuditLogsTable.occurredAt))
            .limit(limit)
            .offset(offset);

        return {
            items: items.map((item) => ({
                ...item,
                occurredAt: item.occurredAt.toISOString(),
                createdAt: item.createdAt.toISOString()
            })) as SelectDbMutationAuditLog[],
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit),
                totalItems: totalCount,
                limit,
                offset
            }
        };
    }

    async findCombinedPaginated(criteria: CombinedAuditLogsSearchCriteria, { limit, offset }: PaginationParams) {
        const { userId, actionType, startDate, endDate } = criteria;

        const auditWhere = and(
            userId ? eq(auditLogsTable.activeUserId, userId) : undefined,
            actionType ? eq(auditLogsTable.actionType, actionType) : undefined,
            startDate ? gte(auditLogsTable.createdAt, new Date(startDate)) : undefined,
            endDate ? lte(auditLogsTable.createdAt, new Date(endDate)) : undefined
        );

        const mutationWhere = and(
            userId ? eq(auditRequestLogTable.actorId, userId) : undefined,
            startDate ? gte(dbMutationAuditLogsTable.occurredAt, new Date(startDate)) : undefined,
            endDate ? lte(dbMutationAuditLogsTable.occurredAt, new Date(endDate)) : undefined
        );

        const [auditCountResult, mutationCountResult] = await Promise.all([
            this.db.select({ count: count() }).from(auditLogsTable).where(auditWhere),
            this.db
                .select({ count: count() })
                .from(dbMutationAuditLogsTable)
                .leftJoin(auditRequestLogTable, eq(dbMutationAuditLogsTable.requestId, auditRequestLogTable.requestId))
                .where(mutationWhere)
        ]);

        const totalCount = (auditCountResult[0]?.count ?? 0) + (mutationCountResult[0]?.count ?? 0);

        // UNION ALL lets Postgres apply ORDER BY + LIMIT + OFFSET across both tables in one pass,
        // avoiding the in-memory merge that breaks for large offsets.
        // Absent columns are typed NULL casts so both sides have an identical column list.
        const auditQuery = this.db
            .select({
                logType: sql<string>`'audit'`,
                id: auditLogsTable.id,
                createdAt: auditLogsTable.createdAt,
                activeUserId: auditLogsTable.activeUserId,
                activeTenantId: auditLogsTable.activeTenantId,
                activeServiceId: auditLogsTable.activeServiceId,
                actionType: sql<string | null>`${auditLogsTable.actionType}`,
                actionDetails: auditLogsTable.actionDetails,
                traceId: auditLogsTable.traceId,
                requestId: auditLogsTable.requestId,
                actorType: auditLogsTable.actorType,
                authSubject: auditLogsTable.authSubject,
                ipAddress: auditLogsTable.ipAddress,
                userAgent: auditLogsTable.userAgent,
                occurredAt: sql<Date | null>`null::timestamptz`,
                tableName: sql<string | null>`null::text`,
                operation: sql<string | null>`null::text`,
                primaryKey: sql<string | null>`null::text`,
                oldRow: sql<Record<string, unknown> | null>`null::jsonb`,
                newRow: sql<Record<string, unknown> | null>`null::jsonb`,
                changedColumns: sql<string[] | null>`null::text[]`,
                jobId: sql<string | null>`null::text`,
                actorId: sql<string | null>`null::text`,
                httpOperation: sql<string | null>`null::text`,
                method: sql<string | null>`null::text`,
                url: sql<string | null>`null::text`
            })
            .from(auditLogsTable)
            .where(auditWhere);

        const mutationQuery = this.db
            .select({
                logType: sql<'db_mutation'>`'db_mutation'`,
                id: dbMutationAuditLogsTable.id,
                createdAt: dbMutationAuditLogsTable.occurredAt,
                activeUserId: sql<string | null>`null::text`,
                activeTenantId: sql<string | null>`null::text`,
                activeServiceId: sql<string | null>`null::text`,
                actionType: sql<string | null>`null::text`,
                actionDetails: sql<Record<string, unknown> | null>`null::jsonb`,
                traceId: auditRequestLogTable.traceId,
                requestId: dbMutationAuditLogsTable.requestId,
                actorType: auditRequestLogTable.actorType,
                authSubject: sql<string | null>`null::text`,
                ipAddress: sql<string | null>`null::text`,
                userAgent: sql<string | null>`null::text`,
                occurredAt: dbMutationAuditLogsTable.occurredAt,
                tableName: dbMutationAuditLogsTable.tableName,
                operation: dbMutationAuditLogsTable.operation,
                primaryKey: dbMutationAuditLogsTable.primaryKey,
                oldRow: sql<Record<string, unknown> | null>`${dbMutationAuditLogsTable.oldRow}`,
                newRow: sql<Record<string, unknown> | null>`${dbMutationAuditLogsTable.newRow}`,
                changedColumns: dbMutationAuditLogsTable.changedColumns,
                jobId: dbMutationAuditLogsTable.jobId,
                actorId: auditRequestLogTable.actorId,
                httpOperation: auditRequestLogTable.operation,
                method: auditRequestLogTable.method,
                url: auditRequestLogTable.url
            })
            .from(dbMutationAuditLogsTable)
            .leftJoin(auditRequestLogTable, eq(dbMutationAuditLogsTable.requestId, auditRequestLogTable.requestId))
            .where(mutationWhere);

        const items = await unionAll(auditQuery, mutationQuery)
            .orderBy(desc(sql`created_at`))
            .limit(limit)
            .offset(offset);

        return {
            items: items.map((item) => {
                if (item.logType === 'audit') {
                    return {
                        logType: 'audit' as const,
                        id: item.id,
                        activeUserId: item.activeUserId,
                        activeTenantId: item.activeTenantId,
                        activeServiceId: item.activeServiceId,
                        actionType: item.actionType as string,
                        actionDetails: item.actionDetails as Record<string, unknown>,
                        traceId: item.traceId,
                        requestId: item.requestId,
                        actorType: item.actorType,
                        authSubject: item.authSubject,
                        ipAddress: item.ipAddress,
                        userAgent: item.userAgent,
                        createdAt: (item.createdAt as Date).toISOString()
                    };
                }
                return {
                    logType: 'db_mutation' as const,
                    id: item.id,
                    occurredAt: (item.occurredAt as Date).toISOString(),
                    tableName: item.tableName as string,
                    operation: item.operation as string,
                    primaryKey: item.primaryKey,
                    oldRow: item.oldRow,
                    newRow: item.newRow,
                    changedColumns: item.changedColumns,
                    requestId: item.requestId,
                    jobId: item.jobId,
                    traceId: item.traceId,
                    actorId: item.actorId,
                    actorType: item.actorType,
                    httpOperation: item.httpOperation,
                    method: item.method,
                    url: item.url,
                    createdAt: (item.createdAt as Date).toISOString()
                };
            }) as SelectUnifiedAuditLog[],
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit),
                totalItems: totalCount,
                limit,
                offset
            }
        };
    }

    /**
     * Find DB mutations filtered by a jsonb field value inside `new_row` or `old_row`.
     * Use for tables whose primary key is composite or a non-id column
     * (e.g. roles, user_roles, contracts with bytea address).
     */
    findMutationsByJsonbField(
        tableName: string,
        operation: 'INSERT' | 'UPDATE' | 'DELETE',
        rowField: 'new_row' | 'old_row',
        fieldName: string,
        fieldValue: string,
        { limit, offset }: PaginationParams = { limit: 50, offset: 0 }
    ) {
        const jsonbCondition =
            rowField === 'new_row'
                ? sql`new_row->>${fieldName} = ${fieldValue}`
                : sql`old_row->>${fieldName} = ${fieldValue}`;
        return this.findMutationsPaginated({ tableName, operation }, { limit, offset }, [jsonbCondition]);
    }
}
