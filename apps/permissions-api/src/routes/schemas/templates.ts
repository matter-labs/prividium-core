import { contractTemplatesTable } from '../../db/schema';
import { nameField } from '../../repositories/shared-schemas';
import { createInsertSchema, createSelectSchema, TIMESTAMP_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { paginatedResult } from '../../utils/schemas/pagination';

export const TemplateSchema = createSelectSchema(contractTemplatesTable);

export const PaginatedTemplatesSchema = paginatedResult(TemplateSchema);

export const CreateTemplateBodySchema = createInsertSchema(contractTemplatesTable, {
    templateKey: (v) =>
        v
            .min(1, 'Template key cannot be empty')
            .regex(
                /^[a-z0-9_-]+$/,
                'Template key must contain only lowercase letters, numbers, hyphens, and underscores'
            ),
    name: nameField
}).omit(TIMESTAMP_COLUMNS);

// templateKey is immutable after creation
export const UpdateTemplateBodySchema = CreateTemplateBodySchema.omit({ templateKey: true }).required();
