import { createSchemaFactory } from 'drizzle-zod';

export const { createInsertSchema, createSelectSchema, createUpdateSchema } = createSchemaFactory({
    coerce: {
        date: true
    }
});

export const TIMESTAMP_COLUMNS = { createdAt: true, updatedAt: true } as const;

export const MANAGED_COLUMNS = { id: true, ...TIMESTAMP_COLUMNS } as const;
