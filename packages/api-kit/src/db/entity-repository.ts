import { and, count, eq, type GetColumnData, type SQL } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgDatabase, PgTable } from 'drizzle-orm/pg-core';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError } from '../error-types';
import type { PaginatedResult, PaginationParams } from '../schemas/pagination';
import { isNoValuesToSetError, isUniqueConstraintError } from './errors';
import { paginate } from './paginate';
import { getFirst, getFirstOrThrow } from './utils';

export type QueryOptions = {
    /** ANDed with the repository base filter and method predicate. */
    filter?: SQL;
    /** Replaces the repository default ordering for this query. */
    orderBy?: (PgColumn | SQL)[];
};

export interface EntityConfig<TTable extends PgTable, TIdColumn extends PgColumn> {
    /** Table this repository reads and mutates. */
    table: TTable;
    /** Column used by by-id reads, updates, and deletes. */
    idColumn: TIdColumn;
    /** Label used in EntityNotFound errors. */
    entityName: string;
    /** Default deterministic ordering for list and paginated reads. */
    defaultOrderBy: (PgColumn | SQL)[];
    /** Always ANDed into reads, updates, and deletes. */
    baseFilter?: SQL;
}

/** Only the query builders are used, never the schema-typed relational API, so a
 * connection and a transaction are interchangeable here. */
type EntityDb = PgDatabase<NodePgQueryResultHKT, Record<string, unknown>>;

// biome-ignore lint/suspicious/noExplicitAny: a mixin constraint has to accept the base's own constructor arguments.
type Constructor = new (...args: any[]) => object;

/**
 * The generic CRUD half of a repository, over whichever base an app owns. The base stays
 * per-app because the transaction augmentor it registers is class-level state, and two
 * apps sharing one class would share that slot.
 */
export function entityRepositoryOn<TBase extends Constructor>(Base: TBase) {
    return function EntityRepository<TTable extends PgTable, TIdColumn extends PgColumn>(
        config: EntityConfig<TTable, TIdColumn>
    ) {
        type Id = GetColumnData<TIdColumn, 'raw'>;
        type Entity = TTable['$inferSelect'];
        type InsertData = TTable['$inferInsert'];
        type UpdateData = Partial<TTable['$inferInsert']>;

        const table: PgTable = config.table;
        const buildWhere = (...filters: (SQL | undefined)[]) => and(config.baseFilter, ...filters);
        const whereId = (id: Id, filter?: SQL) => buildWhere(eq(config.idColumn, id), filter);

        return class extends Base {
            protected declare readonly db: EntityDb;

            async create(data: InsertData): Promise<Entity> {
                try {
                    const row = await this.db.insert(table).values(data).returning().then(getFirstOrThrow);
                    return row as Entity;
                } catch (err) {
                    if (isUniqueConstraintError(err)) {
                        throw new EntityAlreadyExistsError(config.entityName);
                    }
                    throw err;
                }
            }

            async findById(id: Id, options?: QueryOptions): Promise<Entity | undefined> {
                const row = await this.db
                    .select()
                    .from(table)
                    .where(whereId(id, options?.filter))
                    .limit(1)
                    .then(getFirst);
                return row as Entity | undefined;
            }

            async getById(id: Id, options?: QueryOptions): Promise<Entity> {
                const entity = await this.findById(id, options);
                if (entity === undefined) {
                    throw new EntityNotFound(config.entityName, { id: String(id) });
                }
                return entity;
            }

            protected async findOne(options?: QueryOptions): Promise<Entity | undefined> {
                const row = await this.db
                    .select()
                    .from(table)
                    .where(buildWhere(options?.filter))
                    .orderBy(...(options?.orderBy ?? config.defaultOrderBy))
                    .limit(1)
                    .then(getFirst);
                return row as Entity | undefined;
            }

            protected async getOne(options?: QueryOptions): Promise<Entity> {
                const entity = await this.findOne(options);
                if (entity === undefined) {
                    throw new EntityNotFound(config.entityName);
                }
                return entity;
            }

            protected async findMany(options?: QueryOptions): Promise<Entity[]> {
                const rows = await this.db
                    .select()
                    .from(table)
                    .where(buildWhere(options?.filter))
                    .orderBy(...(options?.orderBy ?? config.defaultOrderBy));
                return rows as Entity[];
            }

            async findPaginated(
                { limit, offset }: PaginationParams,
                options?: QueryOptions
            ): Promise<PaginatedResult<Entity>> {
                const where = buildWhere(options?.filter);
                const orderBy = options?.orderBy ?? config.defaultOrderBy;

                return paginate({
                    totalItems: this.db
                        .select({ count: count() })
                        .from(table)
                        .where(where)
                        .then((rows) => getFirstOrThrow(rows).count),
                    items: this.db
                        .select()
                        .from(table)
                        .where(where)
                        .orderBy(...orderBy)
                        .limit(limit)
                        .offset(offset)
                        .then((rows) => rows as Entity[]),
                    limit,
                    offset
                });
            }

            protected async update(data: UpdateData, options?: QueryOptions): Promise<Entity[]> {
                try {
                    const rows = await this.db.update(table).set(data).where(buildWhere(options?.filter)).returning();
                    return rows as Entity[];
                } catch (error) {
                    if (isNoValuesToSetError(error)) {
                        throw new InvalidInputError('No fields to update');
                    }
                    throw error;
                }
            }

            async updateById(id: Id, data: UpdateData): Promise<Entity> {
                const [row] = await this.update(data, { filter: eq(config.idColumn, id) });
                if (row === undefined) {
                    throw new EntityNotFound(config.entityName, { id: String(id) });
                }
                return row;
            }

            protected async delete(options?: QueryOptions): Promise<Entity[]> {
                const rows = await this.db.delete(table).where(buildWhere(options?.filter)).returning();
                return rows as Entity[];
            }

            async deleteById(id: Id): Promise<Entity> {
                const deleted = await this.delete({ filter: eq(config.idColumn, id) }).then(getFirst);
                if (deleted === undefined) {
                    throw new EntityNotFound(config.entityName, { id: String(id) });
                }
                return deleted;
            }
        };
    };
}
