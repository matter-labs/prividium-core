import { Abi } from 'abitype/zod';
import { asc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { contractTemplatesTable } from '../db/schema';
import { escapeLike } from '../db/utils';
import { EntityAlreadyExistsError, InvalidInputError } from '../utils/error-types';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { EntityRepository } from './entity-repository';

const TemplatesRepositoryBase = EntityRepository({
    table: contractTemplatesTable,
    idColumn: contractTemplatesTable.id,
    entityName: 'Template',
    defaultOrderBy: [asc(contractTemplatesTable.name), asc(contractTemplatesTable.id)]
});

export type Template = typeof contractTemplatesTable.$inferSelect;

export type InsertTemplate = typeof contractTemplatesTable.$inferInsert;

// templateKey is immutable after creation, so it is excluded from the update shape.
export type UpdateTemplate = Omit<InsertTemplate, 'templateKey' | 'createdAt' | 'updatedAt'>;

export class TemplatesRepository extends TemplatesRepositoryBase {
    async findPaginated({
        limit,
        offset,
        searchQuery
    }: PaginationParams & { searchQuery?: string }): Promise<PaginatedResult<Template>> {
        const escapedSearch = searchQuery ? escapeLike(searchQuery) : undefined;
        const whereClause: SQL | undefined = escapedSearch
            ? or(
                  ilike(contractTemplatesTable.templateKey, `%${escapedSearch}%`),
                  ilike(contractTemplatesTable.name, `%${escapedSearch}%`),
                  ilike(contractTemplatesTable.description, `%${escapedSearch}%`)
              )
            : undefined;

        return super.findPaginated({ limit, offset }, { filter: whereClause });
    }

    async getByKey(templateKey: string): Promise<Template> {
        return this.getOne({ filter: eq(contractTemplatesTable.templateKey, templateKey) });
    }

    async create(data: InsertTemplate): Promise<Template> {
        this.assertStringIsValidAbi(data.abi);

        const existing = await this.findOne({ filter: eq(contractTemplatesTable.templateKey, data.templateKey) });
        if (existing) {
            throw new EntityAlreadyExistsError('There is already a template with this key');
        }

        return super.create(data);
    }

    async updateById(id: number, data: UpdateTemplate): Promise<Template> {
        this.assertStringIsValidAbi(data.abi);
        return super.updateById(id, data);
    }

    private assertStringIsValidAbi(abiStr: string) {
        try {
            Abi.parse(JSON.parse(abiStr));
        } catch {
            throw new InvalidInputError('Invalid ABI format - must be valid JSON encoded abi');
        }
    }
}
