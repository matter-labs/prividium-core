import { contractEventPermissionsTable } from '../../db/schema';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { hexSizedSchema } from '../../utils/schemas/hex-schema';
import { paginatedResult } from '../../utils/schemas/pagination';
import { BareRoleSchema, RoleRefSchema } from './roles';

// function form so drizzle keeps the columns' nullability
export const EventPermissionSchema = createSelectSchema(contractEventPermissionsTable, {
    contractAddress: () => hexSizedSchema(20),
    topic0Constant: () => hexSizedSchema(32),
    topic1Constant: () => hexSizedSchema(32),
    topic2Constant: () => hexSizedSchema(32),
    topic3Constant: () => hexSizedSchema(32)
}).extend({
    roles: BareRoleSchema.array()
});

export const CreateEventPermissionBodySchema = createInsertSchema(contractEventPermissionsTable, {
    contractAddress: () => hexSizedSchema(20),
    topic0Constant: () => hexSizedSchema(32),
    topic1Constant: () => hexSizedSchema(32),
    topic2Constant: () => hexSizedSchema(32),
    topic3Constant: () => hexSizedSchema(32)
})
    .omit(MANAGED_COLUMNS)
    .extend({ roles: RoleRefSchema.array() });

// PUT full-replace: topic constants AND condition-type cols are all required (null is valid; undefined/omitted is not)
export const UpdateEventPermissionBodySchema = CreateEventPermissionBodySchema.required({
    topic0Constant: true,
    topic1Constant: true,
    topic2Constant: true,
    topic3Constant: true,
    topic1ConditionType: true,
    topic2ConditionType: true,
    topic3ConditionType: true
});

export const PaginatedEventPermissionsSchema = paginatedResult(EventPermissionSchema);
