import { asc, count, eq, isNotNull } from 'drizzle-orm';
import { applicationsTable } from '../db/schema';
import { getFirstOrThrow } from '../db/utils';
import { EntityNotFound } from '../utils/error-types';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { EntityRepository } from './entity-repository';

export type Application = typeof applicationsTable.$inferSelect;

export type InsertApplication = typeof applicationsTable.$inferInsert;

export type UpdateApplication = Partial<InsertApplication>;

export type PublicApplication = Pick<Application, 'oauthClientId' | 'oauthRedirectUris' | 'name'>;

export type PublicApplicationCard = Pick<Application, 'id' | 'name' | 'description' | 'imageUrl' | 'origin'>;

const ApplicationsRepositoryBase = EntityRepository({
    table: applicationsTable,
    idColumn: applicationsTable.id,
    entityName: 'Application',
    defaultOrderBy: [asc(applicationsTable.createdAt), asc(applicationsTable.id)]
});

export class ApplicationsRepository extends ApplicationsRepositoryBase {
    async getByOauthClientId(clientId: string): Promise<PublicApplication> {
        const app = await this.db.query.applicationsTable.findFirst({
            where: (rows, { eq }) => eq(rows.oauthClientId, clientId),
            columns: {
                oauthClientId: true,
                oauthRedirectUris: true,
                name: true
            }
        });

        if (app === undefined) {
            throw new EntityNotFound('Application', { oauthClientId: clientId });
        }

        return app;
    }

    async searchPublicPaginated({ limit, offset }: PaginationParams): Promise<PaginatedResult<PublicApplicationCard>> {
        const countRes = await this.db
            .select({ count: count() })
            .from(applicationsTable)
            .where(eq(applicationsTable.isPublic, true))
            .then(getFirstOrThrow);
        const totalItems = countRes.count;
        const currentPage = Math.floor(offset / limit) + 1;
        const totalPages = Math.ceil(totalItems / limit);

        const items = await this.db
            .select({
                id: applicationsTable.id,
                name: applicationsTable.name,
                description: applicationsTable.description,
                imageUrl: applicationsTable.imageUrl,
                origin: applicationsTable.origin
            })
            .from(applicationsTable)
            .where(eq(applicationsTable.isPublic, true))
            .orderBy(applicationsTable.createdAt, applicationsTable.id)
            .limit(limit)
            .offset(offset);

        return {
            items,
            pagination: { currentPage, totalPages, totalItems, limit, offset }
        };
    }

    async allAppOrigins(): Promise<string[]> {
        const origins = await this.db
            .select({ origin: applicationsTable.origin })
            .from(applicationsTable)
            .where(isNotNull(applicationsTable.origin));

        return origins.map((row) => row.origin as string);
    }
}
