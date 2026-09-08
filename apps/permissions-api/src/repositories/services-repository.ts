import { asc, eq } from 'drizzle-orm';
import type { Address } from 'viem';
import { servicesTable } from '../db/schema';
import { EntityRepository } from './entity-repository';

export type Service = typeof servicesTable.$inferSelect;
export type InsertService = Omit<typeof servicesTable.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;

const ServicesRepositoryBase = EntityRepository({
    table: servicesTable,
    idColumn: servicesTable.id,
    entityName: 'Service',
    defaultOrderBy: [asc(servicesTable.createdAt), asc(servicesTable.id)]
});

export class ServicesRepository extends ServicesRepositoryBase {
    async findByPublicKey(publicKey: Address) {
        return this.findOne({ filter: eq(servicesTable.publicKey, publicKey) });
    }
}
