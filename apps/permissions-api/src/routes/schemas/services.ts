import { servicesTable } from '../../db/schema';
import { nameField } from '../../repositories/shared-schemas';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { hexSchema } from '../../utils/schemas/hex-schema';
import { paginatedResult } from '../../utils/schemas/pagination';

export const ServiceSchema = createSelectSchema(servicesTable, {
    publicKey: hexSchema
});

export const PaginatedServicesSchema = paginatedResult(ServiceSchema);

export const CreateServiceBodySchema = createInsertSchema(servicesTable, {
    name: nameField,
    publicKey: hexSchema
}).omit(MANAGED_COLUMNS);

export const UpdateServiceBodySchema = CreateServiceBodySchema.required();
