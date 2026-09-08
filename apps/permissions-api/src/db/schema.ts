import { ACTOR_TYPE_VALUES, type ActorType as SharedActorType } from '@repo/access-control/src/actor-types';
import type { AuditActionType as SharedAuditActionType } from '@repo/access-control/src/audit-actions';
import { sql } from 'drizzle-orm';
import {
    bigint,
    boolean,
    check,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    primaryKey,
    text,
    unique,
    uniqueIndex
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm/relations';
import { z } from 'zod/v4';
import { ALL_SYSTEM_PERMISSIONS } from '../permissions/system-permissions';
import { createdAt, publicId, timestampTz, updatedAt } from './common-schema';
import { addressColumn, hexBigIntColumn, hexBytesColumn, methodSelectorColumn, uint256Column } from './custom-types';

export const rolesTable = pgTable(
    'roles',
    {
        id: publicId,
        roleName: text().notNull(),
        systemPermissions: text({ enum: ALL_SYSTEM_PERMISSIONS }).array().notNull(),
        isSystemRole: boolean().notNull(),
        // null = zone-level role; non-null = owned by that organization.
        // no action (not cascade/set null): organizations are soft-deleted, so a hard delete must not destroy
        // org-owned roles, and set null would silently promote an org role to a zone-level role.
        organizationId: text().references(() => organizationsTable.id, { onDelete: 'no action' }),
        createdAt,
        updatedAt
    },
    (t) => [
        index('idx_roles_organization_id').on(t.organizationId),
        // nulls not distinct: zone-level roles (null organizationId) share one name namespace.
        unique('uq_roles_organization_id_role_name').on(t.organizationId, t.roleName).nullsNotDistinct()
    ]
);

export const roleRelations = relations(rolesTable, ({ many }) => ({
    userRoles: many(userRolesTable),
    tenantDefaultRoles: many(tenantsDefaultRoles),
    organizationDefaultRoles: many(organizationsDefaultRoles),
    m2mAppRoles: many(m2mAppRolesTable)
}));

const userSources = ['oidc', 'adminPanel', 'tenant', 'crypto_native', 'm2m_app'] as const;
export const UserSources = z.enum(userSources);

export const usersTable = pgTable(
    'users',
    {
        id: publicId,
        oidcSub: text(),
        // OIDC subs are only unique per issuer, so identity is keyed by (issuer, sub).
        oidcIssuer: text(),
        displayName: text().notNull(),
        source: text({ enum: userSources }).notNull(),
        organizationId: text().references(() => organizationsTable.id, { onDelete: 'set null' }),
        walletToken: text(),
        createdAt,
        updatedAt
    },
    (t) => [
        unique('uq_users_oidc_issuer_sub').on(t.oidcIssuer, t.oidcSub),
        // (issuer, sub) treats null issuers as distinct, so it can't keep two pre-login users (admin- or
        // M2M-created, null issuer) from sharing a sub. This guard makes a sub unique among null-issuer users
        // so first-login claiming by sub is unambiguous.
        uniqueIndex('uq_users_oidc_sub_when_no_issuer').on(t.oidcSub).where(sql`${t.oidcIssuer} is null`),
        // Shaped for the user list: the leading column serves its `organization_id = :id` and `IS NULL`
        // filters, and nulls-first matches the zone-users-first ordering, which then needs no sort.
        index('idx_users_organization_id_created_at_id').on(
            t.organizationId.asc().nullsFirst(),
            t.createdAt.asc(),
            t.id.asc()
        )
    ]
);

export const userRelations = relations(usersTable, ({ many, one }) => ({
    roles: many(userRolesTable),
    wallets: many(walletsTable),
    organization: one(organizationsTable, {
        fields: [usersTable.organizationId],
        references: [organizationsTable.id]
    })
}));

export const sessionsTable = pgTable(
    'sessions',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        expiresAt: timestampTz().notNull(),
        tokenHash: text().unique('sessions_token_hash_unique').notNull(),
        createdAt,
        updatedAt,
        ipAddress: text(),
        userAgent: text(),
        userId: text().references(() => usersTable.id, { onDelete: 'cascade' }),
        tenantId: text().references(() => tenantsTable.id, { onDelete: 'cascade' }),
        serviceId: text().references(() => servicesTable.id, { onDelete: 'cascade' }),
        revokedBy: text().references(() => usersTable.id, { onDelete: 'set null' }),
        revokedAt: timestampTz(),
        // Currently only 'docs' is used (Swagger UI / OpenAPI spec reads under /docs).
        scope: text().$type<'docs'>(),
        // The latest expiresAt can ever slide to — the absolute session cap. Idle extension can move
        // expiresAt forward but never past this. Nullable so pre-migration rows backfill cleanly.
        renewableUntil: timestampTz()
    },
    (t) => [
        index('idx_sessions_token_hash').on(t.tokenHash),
        index('idx_sessions_expires_at').on(t.expiresAt),
        check(
            'chk_sessions_owner',
            sql`${t.userId} IS NOT NULL OR ${t.tenantId} IS NOT NULL OR ${t.serviceId} IS NOT NULL`
        )
    ]
);

export const userRolesTable = pgTable(
    'user_roles',
    {
        userId: text()
            .notNull()
            .references(() => usersTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        roleId: text()
            .notNull()
            .references(() => rolesTable.id, { onDelete: 'cascade' }),
        createdAt,
        updatedAt
    },
    (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index('idx_user_roles_role_id').on(t.roleId)]
);

export const userRolesRelations = relations(userRolesTable, ({ one }) => ({
    user: one(usersTable, {
        fields: [userRolesTable.userId],
        references: [usersTable.id]
    }),
    role: one(rolesTable, {
        fields: [userRolesTable.roleId],
        references: [rolesTable.id]
    })
}));

export const walletsTable = pgTable(
    'user_wallets',
    {
        id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
        walletAddress: addressColumn().notNull(),
        userId: text()
            .notNull()
            .references(() => usersTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        createdAt,
        updatedAt,
        deletedAt: timestampTz()
    },
    (t) => [uniqueIndex('user_wallets_address_active_unique').on(t.walletAddress).where(sql`${t.deletedAt} IS NULL`)]
);

export const walletRelations = relations(walletsTable, ({ one }) => ({
    user: one(usersTable, {
        fields: [walletsTable.userId],
        references: [usersTable.id]
    })
}));

export const walletTransactionAllowancesTable = pgTable(
    'wallet_transaction_allowances',
    {
        userId: text()
            .notNull()
            .references(() => usersTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        walletAddress: addressColumn().notNull(),
        toAddress: addressColumn(),
        transactionNonce: integer().notNull(),
        transactionCalldata: hexBytesColumn().notNull(),
        transactionValue: uint256Column().notNull(),
        transactionHash: hexBytesColumn(),
        activeUntil: timestampTz().notNull(),
        createdAt,
        updatedAt
    },
    (t) => [
        primaryKey({ columns: [t.userId, t.walletAddress, t.transactionNonce] }),
        check(
            'chk_wallet_allowance_tx_value_uint256',
            // Ensure that transactionValue is within uint256 range (0 to 2^256 - 1). The max uint is inlined here
            // because Drizzle will create parameter if you pass const from outside sql`...`.
            sql`${t.transactionValue} >= 0 AND ${t.transactionValue} <= ${numeric('115792089237316195423570985008687907853269984665640564039457584007913129639935')}`
        )
    ]
);

const faucetClaimStatuses = ['pending', 'success', 'failed'] as const;
export const FaucetClaimStatus = z.enum(faucetClaimStatuses);
export type FaucetClaimStatus = z.infer<typeof FaucetClaimStatus>;

export const faucetClaimsTable = pgTable(
    'faucet_claims',
    {
        id: publicId,
        userId: text()
            .notNull()
            .references(() => usersTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        walletAddress: addressColumn().notNull(),
        amountWei: uint256Column().notNull(),
        txHash: hexBytesColumn(),
        status: text({ enum: faucetClaimStatuses }).notNull(),
        createdAt,
        updatedAt
    },
    (t) => [
        uniqueIndex('faucet_claims_one_pending_per_user').on(t.userId).where(sql`${t.status} = 'pending'`),
        index('idx_faucet_claims_user_created').on(t.userId, t.createdAt),
        index('idx_faucet_claims_status_created').on(t.status, t.createdAt),
        // Belt-and-braces: enforce at the DB layer that any `success` row has its on-chain
        // tx hash recorded. The service path always sets txHash before flipping status to
        // `success`, but a future refactor or manual data fix could violate that invariant
        // without this constraint.
        check('chk_faucet_claims_success_has_tx_hash', sql`${t.status} <> 'success' OR ${t.txHash} IS NOT NULL`)
    ]
);

export const faucetClaimsRelations = relations(faucetClaimsTable, ({ one }) => ({
    user: one(usersTable, {
        fields: [faucetClaimsTable.userId],
        references: [usersTable.id]
    })
}));

const methodRuleTypes = [
    'public',
    'checkRole',
    'restrictArgument',
    'checkRoleAndRestrictArgument',
    'checkRoleOrRestrictArgument'
] as const;
export const methodRuleSchema = z.enum(methodRuleTypes);
export type MethodRule = z.infer<typeof methodRuleSchema>;

const methodAccessTypes = ['read', 'write'] as const;
export const methodAccessSchema = z.enum(methodAccessTypes);
export type MethodAccessType = z.infer<typeof methodAccessSchema>;

export const contractFunctionPermissionsTable = pgTable(
    'contract_function_permissions',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        contractAddress: addressColumn()
            .notNull()
            .references(() => contractsTable.contractAddress, { onUpdate: 'cascade', onDelete: 'cascade' }),
        methodSelector: methodSelectorColumn().notNull(),
        accessType: text({ enum: methodAccessTypes }).notNull(),
        functionSignature: text().notNull(),
        ruleType: text({ enum: methodRuleTypes }).notNull(),
        isUmbrella: boolean().notNull().default(false),
        organizationOnly: boolean().notNull().default(true),
        createdAt,
        updatedAt
    },
    (t) => [unique('contract_function_permissions_unique_attributes').on(t.contractAddress, t.methodSelector)]
);

export const contractFunctionPermissionRelations = relations(contractFunctionPermissionsTable, ({ many }) => ({
    roles: many(contractFunctionPermissionRolesTable),
    argumentRestrictions: many(argumentRestrictionsTable)
}));

const topicConditionTypes = ['equalTo', 'userAddress'] as const;
export const topicConditionEnum = z.enum(topicConditionTypes);
export type TopicConditionType = z.infer<typeof topicConditionEnum>;

export const contractEventPermissionsTable = pgTable(
    'contract_event_permissions',
    {
        id: publicId,
        contractAddress: addressColumn()
            .notNull()
            .references(() => contractsTable.contractAddress, { onUpdate: 'cascade', onDelete: 'cascade' }),
        topic0Constant: hexBytesColumn(),
        topic1Constant: hexBytesColumn(),
        topic2Constant: hexBytesColumn(),
        topic3Constant: hexBytesColumn(),
        topic1ConditionType: text({ enum: topicConditionTypes }),
        topic2ConditionType: text({ enum: topicConditionTypes }),
        topic3ConditionType: text({ enum: topicConditionTypes }),
        organizationOnly: boolean().notNull().default(true),
        createdAt,
        updatedAt
    },
    (t) => [
        index('').on(t.contractAddress, t.topic0Constant),
        check(
            'chk_conditions_',
            sql`
                    ((${t.topic1Constant} IS NULL) OR (${t.topic1Constant} IS NOT NULL AND ${t.topic1ConditionType} = 'equalTo'))
                    AND
                    ((${t.topic2Constant} IS NULL) OR (${t.topic2Constant} IS NOT NULL AND ${t.topic2ConditionType} = 'equalTo'))
                    AND
                    ((${t.topic3Constant} IS NULL) OR (${t.topic3Constant} IS NOT NULL AND ${t.topic3ConditionType} = 'equalTo'))
            `
        )
    ]
);

export const contractEventPermissionsTableRelations = relations(contractEventPermissionsTable, ({ many, one }) => ({
    roles: many(contractEventPermissionsRoles),
    contract: one(contractsTable, {
        fields: [contractEventPermissionsTable.contractAddress],
        references: [contractsTable.contractAddress]
    })
}));

export const contractEventPermissionsRoles = pgTable('contract_event_permissions_roles', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    eventPermissionId: text()
        .notNull()
        .references(() => contractEventPermissionsTable.id, {
            onUpdate: 'cascade',
            onDelete: 'cascade'
        }),
    roleId: text()
        .notNull()
        .references(() => rolesTable.id, {
            onDelete: 'cascade'
        }),
    createdAt,
    updatedAt
});

export const contractEventPermissionsRolesRelations = relations(contractEventPermissionsRoles, ({ one }) => ({
    role: one(rolesTable, {
        fields: [contractEventPermissionsRoles.roleId],
        references: [rolesTable.id]
    }),
    eventPermission: one(contractEventPermissionsTable, {
        fields: [contractEventPermissionsRoles.eventPermissionId],
        references: [contractEventPermissionsTable.id]
    })
}));

export const contractFunctionPermissionRolesTable = pgTable(
    'contract_function_permission_roles',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        permissionId: integer().references(() => contractFunctionPermissionsTable.id, {
            onUpdate: 'cascade',
            onDelete: 'cascade'
        }),
        roleId: text()
            .notNull()
            .references(() => rolesTable.id, { onDelete: 'cascade' }),
        createdAt,
        updatedAt
    },
    (t) => [
        unique('contract_function_permission_roles_unique_role').on(t.permissionId, t.roleId),
        index('idx_contract_function_permission_roles_role_id').on(t.roleId)
    ]
);

export const contractFunctionPermissionRolesRelations = relations(contractFunctionPermissionRolesTable, ({ one }) => ({
    permission: one(contractFunctionPermissionsTable, {
        fields: [contractFunctionPermissionRolesTable.permissionId],
        references: [contractFunctionPermissionsTable.id]
    }),
    role: one(rolesTable, {
        fields: [contractFunctionPermissionRolesTable.roleId],
        references: [rolesTable.id]
    })
}));

export const argumentRestrictionsTable = pgTable(
    'function_argument_restrictions',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        permissionId: integer().references(() => contractFunctionPermissionsTable.id, {
            onUpdate: 'cascade',
            onDelete: 'cascade'
        }),
        argumentIndex: integer().notNull()
    },
    (t) => [unique('unique_input_restriction_per_method').on(t.permissionId, t.argumentIndex)]
);

export const inputRestrictionsRelations = relations(argumentRestrictionsTable, ({ one }) => ({
    permission: one(contractFunctionPermissionsTable, {
        fields: [argumentRestrictionsTable.permissionId],
        references: [contractFunctionPermissionsTable.id]
    })
}));

// Contract Templates
export const contractTemplatesTable = pgTable(
    'contract_templates',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        templateKey: text().notNull().unique(),
        name: text().notNull(),
        description: text(),
        abi: text().notNull(),
        createdAt,
        updatedAt
    },
    (t) => [index('idx_contract_templates_key').on(t.templateKey)]
);

export const contractTemplateRelations = relations(contractTemplatesTable, ({ many }) => ({
    permissions: many(contractTemplatePermissionsTable),
    contracts: many(contractsTable)
}));

export const contractTemplatePermissionsTable = pgTable(
    'contract_template_permissions',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        templateId: integer()
            .notNull()
            .references(() => contractTemplatesTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        methodSelector: methodSelectorColumn().notNull(),
        accessType: text({ enum: methodAccessTypes }).notNull(),
        functionSignature: text().notNull(),
        ruleType: text({ enum: methodRuleTypes }).notNull(),
        isUmbrella: boolean().notNull().default(false),
        organizationOnly: boolean().notNull().default(true),
        createdAt,
        updatedAt
    },
    (t) => [unique('template_permissions_unique_attributes').on(t.templateId, t.methodSelector)]
);

export const contractTemplatePermissionRelations = relations(contractTemplatePermissionsTable, ({ one, many }) => ({
    template: one(contractTemplatesTable, {
        fields: [contractTemplatePermissionsTable.templateId],
        references: [contractTemplatesTable.id]
    }),
    roles: many(contractTemplatePermissionRolesTable),
    argumentRestrictions: many(contractTemplateArgumentRestrictionsTable)
}));

export const contractTemplatePermissionRolesTable = pgTable(
    'contract_template_permission_roles',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        permissionId: integer().references(() => contractTemplatePermissionsTable.id, {
            onUpdate: 'cascade',
            onDelete: 'cascade'
        }),
        roleId: text()
            .notNull()
            .references(() => rolesTable.id, { onDelete: 'cascade' }),
        createdAt,
        updatedAt
    },
    (t) => [unique('template_permission_roles_unique_role').on(t.permissionId, t.roleId)]
);

export const contractTemplatePermissionRolesRelations = relations(contractTemplatePermissionRolesTable, ({ one }) => ({
    permission: one(contractTemplatePermissionsTable, {
        fields: [contractTemplatePermissionRolesTable.permissionId],
        references: [contractTemplatePermissionsTable.id]
    }),
    role: one(rolesTable, {
        fields: [contractTemplatePermissionRolesTable.roleId],
        references: [rolesTable.id]
    })
}));

export const contractTemplateArgumentRestrictionsTable = pgTable(
    'contract_template_argument_restrictions',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        permissionId: integer().references(() => contractTemplatePermissionsTable.id, {
            onUpdate: 'cascade',
            onDelete: 'cascade'
        }),
        argumentIndex: integer().notNull()
    },
    (t) => [unique('template_unique_input_restriction_per_method').on(t.permissionId, t.argumentIndex)]
);

export const contractTemplateArgumentRestrictionsRelations = relations(
    contractTemplateArgumentRestrictionsTable,
    ({ one }) => ({
        permission: one(contractTemplatePermissionsTable, {
            fields: [contractTemplateArgumentRestrictionsTable.permissionId],
            references: [contractTemplatePermissionsTable.id]
        })
    })
);

export const contractsTable = pgTable(
    'contracts',
    {
        contractAddress: addressColumn().primaryKey(),
        abi: text().notNull(),
        name: text(),
        description: text(),
        discloseErc20TotalSupply: boolean().notNull().default(false),
        discloseBytecode: boolean().notNull().default(false),
        disclosureStartBlock: hexBigIntColumn().notNull(),
        templateId: integer().references(() => contractTemplatesTable.id, {
            onUpdate: 'cascade',
            onDelete: 'set null'
        }),
        isSystemContract: boolean().notNull().default(false),
        // null = zone-level contract (shared); non-null = private to that organization.
        // no action (not cascade/set null): organizations are soft-deleted, so a hard delete must not destroy
        // an org's private contracts, and set null would silently expose a private contract zone-wide.
        organizationId: text().references(() => organizationsTable.id, { onDelete: 'no action' }),
        createdAt,
        updatedAt
    },
    (t) => [
        index('idx_contracts_template_id').on(t.templateId),
        index('idx_contracts_organization_id').on(t.organizationId)
    ]
);

export const contractsRelations = relations(contractsTable, ({ one, many }) => ({
    template: one(contractTemplatesTable, {
        fields: [contractsTable.templateId],
        references: [contractTemplatesTable.id]
    }),
    disclosedAddresses: many(disclosedAddressesTable),
    inputRestrictions: many(argumentRestrictionsTable)
}));

export const contractDeploymentsTable = pgTable('contract_deployments', {
    id: publicId,
    address: addressColumn().notNull(),
    deployedBy: text()
        .references(() => usersTable.id, { onDelete: 'cascade' })
        .notNull(),
    deployerAddress: addressColumn().notNull(),
    deployerNonce: bigint({ mode: 'number' }).notNull(),
    deployTxHash: hexBytesColumn().notNull(),
    startedAt: timestampTz(),
    successAt: timestampTz(),
    erroredAt: timestampTz(),
    errorMessage: text(),
    createdAt,
    updatedAt
});

const disclosureTypes = ['all', 'none', 'list'] as const;
export const bytecodeDisclosureTypeSchema = z.enum(disclosureTypes);
export type BytecodeDisclosureType = z.infer<typeof bytecodeDisclosureTypeSchema>;

export const bytecodeDisclosurePermissionsTable = pgTable('bytecode_disclosure_permissions', {
    address: addressColumn().primaryKey(),
    type: text({ enum: disclosureTypes }).notNull(),
    createdAt,
    updatedAt
});

export const bytecodeDisclosurePermissionRolesTable = pgTable(
    'bytecode_disclosure_permission_roles',
    {
        address: addressColumn()
            .notNull()
            .references(() => bytecodeDisclosurePermissionsTable.address, { onUpdate: 'cascade', onDelete: 'cascade' }),
        roleId: text()
            .notNull()
            .references(() => rolesTable.id, { onDelete: 'cascade' }),
        createdAt,
        updatedAt
    },
    (t) => [primaryKey({ columns: [t.address, t.roleId] })]
);

export const bytecodeDisclosureRelations = relations(bytecodeDisclosurePermissionsTable, ({ many }) => ({
    roles: many(bytecodeDisclosurePermissionRolesTable)
}));

export const bytecodeDisclosureRolesRelations = relations(bytecodeDisclosurePermissionRolesTable, ({ one }) => ({
    permission: one(bytecodeDisclosurePermissionsTable, {
        fields: [bytecodeDisclosurePermissionRolesTable.address],
        references: [bytecodeDisclosurePermissionsTable.address]
    })
}));

export const disclosedAddressesTable = pgTable(
    'disclosed_addresses',
    {
        contractAddress: addressColumn()
            .notNull()
            .references(() => contractsTable.contractAddress, { onUpdate: 'cascade', onDelete: 'cascade' }),
        address: addressColumn().notNull()
    },
    (t) => [primaryKey({ columns: [t.contractAddress, t.address] })]
);

export const disclosedAddressesRelations = relations(disclosedAddressesTable, ({ one }) => ({
    contract: one(contractsTable, {
        fields: [disclosedAddressesTable.contractAddress],
        references: [contractsTable.contractAddress]
    })
}));

const targetTypes = ['user', 'tenant', 'service'] as const;
export const TargetTypes = z.enum(targetTypes);
export type TargetType = z.infer<typeof TargetTypes>;

export const siweConsumedNoncesTable = pgTable(
    'siwe_consumed_nonces',
    {
        nonceHash: text().primaryKey(),
        consumedAt: timestampTz().notNull().defaultNow()
    },
    (t) => [index('idx_siwe_consumed_nonces_consumed_at').on(t.consumedAt)]
);

export const siweChallengeLogTable = pgTable(
    'siwe_challenge_log',
    {
        id: publicId,
        address: addressColumn().notNull(),
        targetType: text({ enum: targetTypes }).notNull(),
        createdAt
    },
    (t) => [index('idx_siwe_challenge_log_address_created').on(t.address, t.createdAt)]
);

const passkeyTransports = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'] as const;
export const PasskeyTransports = z.enum(passkeyTransports);
export type PasskeyTransport = z.infer<typeof PasskeyTransports>;

export const passkeyCredentialsTable = pgTable(
    'passkey_credentials',
    {
        id: publicId,
        userId: text()
            .notNull()
            .references(() => usersTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        credentialId: text().notNull().unique(),
        publicKey: text().notNull(),
        // Signature counter incremented by the authenticator on each use. Used to detect cloned authenticators.
        counter: bigint({ mode: 'number' }).notNull().default(0),
        deviceName: text(),
        transports: text({ enum: passkeyTransports }).array(),
        lastUsedAt: timestampTz(),
        createdAt,
        updatedAt
    },
    (t) => [
        index('idx_passkey_credentials_user_id').on(t.userId),
        index('idx_passkey_credentials_credential_id').on(t.credentialId)
    ]
);

const passkeyChallengeTypes = ['registration', 'authentication', 'step_up'] as const;
export const PasskeyChallengeTypes = z.enum(passkeyChallengeTypes);

export const passkeyChallengesTable = pgTable(
    'passkey_challenges',
    {
        challenge: text().primaryKey(),
        userId: text()
            .notNull()
            .references(() => usersTable.id, { onDelete: 'cascade' }),
        challengeType: text({ enum: passkeyChallengeTypes }).notNull(),
        alreadyUsed: boolean().notNull().default(false),
        expiresAt: timestampTz().notNull(),
        linkedSiweNonce: text(),
        linkedAction: text(),
        createdAt,
        updatedAt
    },
    (t) => [
        index('idx_passkey_challenges_user_id').on(t.userId),
        index('idx_passkey_challenges_expires_at').on(t.expiresAt)
    ]
);

export const stepUpProofsTable = pgTable(
    'step_up_proofs',
    {
        id: publicId,
        proofHash: text().notNull().unique(),
        sessionTokenHash: text().notNull(),
        userId: text()
            .notNull()
            .references(() => usersTable.id, { onDelete: 'cascade' }),
        action: text().notNull(),
        consumedAt: timestampTz(),
        expiresAt: timestampTz().notNull(),
        createdAt,
        updatedAt
    },
    (t) => [
        index('idx_step_up_proofs_user_id').on(t.userId),
        index('idx_step_up_proofs_expires_at').on(t.expiresAt),
        index('idx_step_up_proofs_session_token_hash').on(t.sessionTokenHash)
    ]
);

export const applicationsTable = pgTable('applications', {
    id: publicId,
    name: text().notNull(),
    oauthClientId: text().notNull().unique(),
    oauthRedirectUris: text().array().notNull().default(sql`ARRAY[]::text[]`),
    origin: text(),
    isPublic: boolean().notNull().default(false),
    description: text(),
    imageUrl: text(),
    createdAt,
    updatedAt
});

export const m2mApplicationsTable = pgTable(
    'm2m_applications',
    {
        id: publicId,
        name: text().notNull(),
        description: text(),
        // null = zone-level credential (operator-owned); non-null = private to that organization.
        // Named `ownerOrganizationId` (not `organizationId`) to disambiguate from the assignment junction
        // `m2mApplicationsOrganizationsTable.organizationId`: this column is who *owns* the credential,
        // whereas the junction is which orgs an operator-owned credential is *shared with*.
        // no action (not cascade/set null): organizations are soft-deleted, so a hard delete must not destroy
        // an org's credentials, and set null would silently expose a private credential zone-wide.
        ownerOrganizationId: text().references(() => organizationsTable.id, { onDelete: 'no action' }),
        createdAt,
        updatedAt
    },
    (t) => [index('idx_m2m_applications_owner_organization_id').on(t.ownerOrganizationId)]
);

export const organizationsTable = pgTable('organizations', {
    id: publicId,
    name: text().notNull(),
    brandName: text(),
    logoUrl: text(),
    primaryColor: text(),
    // SIWE wallet login for this organization (zone-admin managed): when enabled, the org's OIDC
    // userPanelUrl host and siweAllowedDomains become valid SIWE domains for login challenges.
    // Authenticated wallet-association challenges accept the member org's domains regardless.
    siweLoginEnabled: boolean().notNull().default(false),
    siweAllowedDomains: text().array().notNull().default([]),
    deletedAt: timestampTz(),
    createdAt,
    updatedAt
});

export const oidcProvidersTable = pgTable('oidc_providers', {
    organizationId: text()
        .primaryKey()
        .references(() => organizationsTable.id, { onUpdate: 'cascade' }),
    issuer: text().notNull().unique(),
    jwksUri: text().notNull(),
    audience: text().notNull(),
    clientId: text().notNull(),
    displayName: text(),
    userPanelUrl: text(),
    createdAt,
    updatedAt
});

export const oidcProvidersRelations = relations(oidcProvidersTable, ({ one }) => ({
    organization: one(organizationsTable, {
        fields: [oidcProvidersTable.organizationId],
        references: [organizationsTable.id]
    })
}));

export const orgPendingAdminsTable = pgTable(
    'org_pending_admins',
    {
        id: publicId,
        organizationId: text()
            .notNull()
            // no action (not cascade): organizations are soft-deleted, so a hard delete must not destroy
            // pending-admin invitations.
            .references(() => organizationsTable.id, { onUpdate: 'cascade', onDelete: 'no action' }),
        oidcSub: text().notNull(),
        createdAt,
        updatedAt
    },
    (t) => [
        unique('uq_org_pending_admins_org_sub').on(t.organizationId, t.oidcSub),
        index('idx_org_pending_admins_oidc_sub').on(t.oidcSub)
    ]
);

export const orgPendingAdminsRelations = relations(orgPendingAdminsTable, ({ one }) => ({
    organization: one(organizationsTable, {
        fields: [orgPendingAdminsTable.organizationId],
        references: [organizationsTable.id]
    })
}));

export const m2mAppRolesTable = pgTable(
    'm2m_app_roles',
    {
        m2mAppId: text()
            .notNull()
            .references(() => m2mApplicationsTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        roleId: text()
            .notNull()
            .references(() => rolesTable.id, { onDelete: 'cascade' }),
        createdAt,
        updatedAt
    },
    (t) => [primaryKey({ columns: [t.m2mAppId, t.roleId] })]
);

export const tenantsTable = pgTable('tenants', {
    id: publicId,
    name: text().notNull(),
    publicKey: addressColumn().notNull().unique(),
    createdAt,
    updatedAt
});

export const servicesTable = pgTable('services', {
    id: publicId,
    name: text().notNull(),
    publicKey: addressColumn().notNull().unique(),
    description: text(),
    createdAt,
    updatedAt
});

export const tenantsDefaultRoles = pgTable(
    'tenants_default_roles',
    {
        tenantId: text()
            .notNull()
            .references(() => tenantsTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        roleId: text()
            .notNull()
            .references(() => rolesTable.id, { onDelete: 'cascade' }),
        createdAt,
        updatedAt
    },
    (t) => [primaryKey({ columns: [t.tenantId, t.roleId] })]
);

export const tenantsUsers = pgTable(
    'tenants_users',
    {
        tenantId: text()
            .notNull()
            .references(() => tenantsTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        userId: text()
            .notNull()
            .references(() => usersTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        createdAt,
        updatedAt
    },
    (t) => [primaryKey({ columns: [t.tenantId, t.userId] })]
);

export const organizationsDefaultRoles = pgTable(
    'organizations_default_roles',
    {
        organizationId: text()
            .notNull()
            // no action (not cascade): organizations are soft-deleted, so a hard delete must not destroy
            // the org's default-role assignments.
            .references(() => organizationsTable.id, { onUpdate: 'cascade', onDelete: 'no action' }),
        roleId: text()
            .notNull()
            .references(() => rolesTable.id, { onDelete: 'cascade' }),
        createdAt,
        updatedAt
    },
    (t) => [primaryKey({ columns: [t.organizationId, t.roleId] })]
);

export const m2mApplicationsOrganizationsTable = pgTable(
    'm2m_applications_organizations',
    {
        m2mAppId: text()
            .notNull()
            .references(() => m2mApplicationsTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        organizationId: text()
            .notNull()
            // no action (not cascade): organizations are soft-deleted, so a hard delete must not destroy
            // M2M-app ↔ organization links.
            .references(() => organizationsTable.id, { onUpdate: 'cascade', onDelete: 'no action' }),
        createdAt,
        updatedAt
    },
    (t) => [primaryKey({ columns: [t.m2mAppId, t.organizationId] })]
);

export const apiKeysTable = pgTable(
    'api_keys',
    {
        id: publicId,
        name: text().notNull(),
        keyHash: text().notNull().unique(),
        keyPrefix: text().notNull(),
        expiresAt: timestampTz().notNull(),
        lastUsedAt: timestampTz(),
        lastUsedIp: text(),
        revokedAt: timestampTz(),
        createdAt,
        updatedAt,
        tenantId: text().references(() => tenantsTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        m2mAppId: text().references(() => m2mApplicationsTable.id, { onUpdate: 'cascade', onDelete: 'cascade' })
    },
    (t) => [
        check('chk_api_keys_single_owner', sql`(${t.tenantId} IS NOT NULL) <> (${t.m2mAppId} IS NOT NULL)`),
        index('idx_api_keys_key_hash').on(t.keyHash),
        index('idx_api_keys_tenant_id').on(t.tenantId),
        index('idx_api_keys_m2m_app_id').on(t.m2mAppId)
    ]
);

export const apiKeysIpWhitelistTable = pgTable(
    'api_keys_ip_whitelist',
    {
        id: publicId,
        ipAddress: text().notNull(),
        description: text(),
        createdAt,
        updatedAt,
        tenantId: text().references(() => tenantsTable.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
        m2mAppId: text().references(() => m2mApplicationsTable.id, { onUpdate: 'cascade', onDelete: 'cascade' })
    },
    (t) => [
        check(
            'chk_api_keys_ip_whitelist_single_owner',
            sql`(${t.tenantId} IS NOT NULL) <> (${t.m2mAppId} IS NOT NULL)`
        ),
        unique('api_keys_ip_whitelist_tenant_id_ip_address_unique').on(t.tenantId, t.ipAddress),
        unique('api_keys_ip_whitelist_m2m_app_id_ip_address_unique').on(t.m2mAppId, t.ipAddress),
        index('idx_api_keys_ip_whitelist_tenant_id').on(t.tenantId),
        index('idx_api_keys_ip_whitelist_m2m_app_id').on(t.m2mAppId)
    ]
);

export const tenantRelations = relations(tenantsTable, ({ many }) => ({
    defaultRoles: many(tenantsDefaultRoles),
    users: many(tenantsUsers),
    apiKeys: many(apiKeysTable),
    ipWhitelist: many(apiKeysIpWhitelistTable)
}));

export const organizationRelations = relations(organizationsTable, ({ many }) => ({
    defaultRoles: many(organizationsDefaultRoles),
    users: many(usersTable),
    m2mApplications: many(m2mApplicationsOrganizationsTable)
}));

export const m2mApplicationsRelations = relations(m2mApplicationsTable, ({ many }) => ({
    roles: many(m2mAppRolesTable),
    apiKeys: many(apiKeysTable),
    ipWhitelist: many(apiKeysIpWhitelistTable),
    organizations: many(m2mApplicationsOrganizationsTable)
}));

export const apiKeysRelations = relations(apiKeysTable, ({ one }) => ({
    tenant: one(tenantsTable, {
        fields: [apiKeysTable.tenantId],
        references: [tenantsTable.id]
    }),
    m2mApp: one(m2mApplicationsTable, {
        fields: [apiKeysTable.m2mAppId],
        references: [m2mApplicationsTable.id]
    })
}));

export const apiKeysIpWhitelistRelations = relations(apiKeysIpWhitelistTable, ({ one }) => ({
    tenant: one(tenantsTable, {
        fields: [apiKeysIpWhitelistTable.tenantId],
        references: [tenantsTable.id]
    }),
    m2mApp: one(m2mApplicationsTable, {
        fields: [apiKeysIpWhitelistTable.m2mAppId],
        references: [m2mApplicationsTable.id]
    })
}));

export const tenantDefaultRolesRelations = relations(tenantsDefaultRoles, ({ one }) => ({
    tenant: one(tenantsTable, {
        fields: [tenantsDefaultRoles.tenantId],
        references: [tenantsTable.id]
    }),
    role: one(rolesTable, {
        fields: [tenantsDefaultRoles.roleId],
        references: [rolesTable.id]
    })
}));

export const organizationDefaultRolesRelations = relations(organizationsDefaultRoles, ({ one }) => ({
    organization: one(organizationsTable, {
        fields: [organizationsDefaultRoles.organizationId],
        references: [organizationsTable.id]
    }),
    role: one(rolesTable, {
        fields: [organizationsDefaultRoles.roleId],
        references: [rolesTable.id]
    })
}));

export const m2mAppRolesRelations = relations(m2mAppRolesTable, ({ one }) => ({
    m2mApp: one(m2mApplicationsTable, {
        fields: [m2mAppRolesTable.m2mAppId],
        references: [m2mApplicationsTable.id]
    }),
    role: one(rolesTable, {
        fields: [m2mAppRolesTable.roleId],
        references: [rolesTable.id]
    })
}));
export const auditActionTypeSchema = z
    .string()
    .regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/, 'Audit action must be namespaced, e.g. "user.update"');
export type AuditActionType = SharedAuditActionType;

export const auditActorTypeSchema = z.enum(ACTOR_TYPE_VALUES);
export type ActorType = SharedActorType;

export const m2mApplicationsOrganizationsRelations = relations(m2mApplicationsOrganizationsTable, ({ one }) => ({
    m2mApp: one(m2mApplicationsTable, {
        fields: [m2mApplicationsOrganizationsTable.m2mAppId],
        references: [m2mApplicationsTable.id]
    }),
    organization: one(organizationsTable, {
        fields: [m2mApplicationsOrganizationsTable.organizationId],
        references: [organizationsTable.id]
    })
}));

export const auditLogsTable = pgTable(
    'audit_logs',
    {
        id: publicId,
        // FK-less, denormalized actor columns: an audit row must survive its actor's deletion unchanged
        // (tamper-free trail). A cascade FK would erase history; set-null would blank the actor. See #1280.
        activeUserId: text(), // Nullable for system operations
        activeTenantId: text(), // Nullable for user operations
        activeServiceId: text(), // Nullable for service operations
        // Plain text: a feature contributes its own action names and the core cannot
        // enumerate what it does not ship. `auditActionTypeSchema` shapes reads, not writes.
        actionType: text().notNull(),
        actionDetails: jsonb().notNull(), // JSONB containing all action details
        traceId: text(), // Correlation ID spanning multiple services/requests
        requestId: text(), // Unique ID for the individual HTTP request
        actorType: text({ enum: ACTOR_TYPE_VALUES }),
        authSubject: text(), // Session token hash or API key ID used to authenticate
        ipAddress: text(),
        userAgent: text(),
        // null = zone-level action; non-null = scoped to that organization.
        // restrict (not set null/cascade): audit records are tamper-free and must never be mutated by an org deletion.
        activeOrganizationId: text().references(() => organizationsTable.id, {
            onUpdate: 'cascade',
            onDelete: 'restrict'
        }),
        createdAt
    },
    (t) => [
        index('idx_audit_logs_user_id').on(t.activeUserId),
        index('idx_audit_logs_tenant_id').on(t.activeTenantId),
        index('idx_audit_logs_service_id').on(t.activeServiceId),
        index('idx_audit_logs_action_type').on(t.actionType),
        index('idx_audit_logs_created_at').on(t.createdAt),
        index('idx_audit_logs_user_created').on(t.activeUserId, t.createdAt),
        index('idx_audit_logs_tenant_created').on(t.activeTenantId, t.createdAt),
        index('idx_audit_logs_service_created').on(t.activeServiceId, t.createdAt),
        index('idx_audit_logs_action_created').on(t.actionType, t.createdAt),
        index('idx_audit_logs_organization_id').on(t.activeOrganizationId)
    ]
);

// actor columns are FK-less (see auditLogsTable) — intentionally not relations
export const auditLogsRelations = relations(auditLogsTable, ({ one }) => ({
    organization: one(organizationsTable, {
        fields: [auditLogsTable.activeOrganizationId],
        references: [organizationsTable.id]
    })
}));

export const passkeyCredentialsRelations = relations(passkeyCredentialsTable, ({ one }) => ({
    user: one(usersTable, { fields: [passkeyCredentialsTable.userId], references: [usersTable.id] })
}));

export const passkeyChallengesRelations = relations(passkeyChallengesTable, ({ one }) => ({
    user: one(usersTable, { fields: [passkeyChallengesTable.userId], references: [usersTable.id] })
}));

// Audit resource types used in audit log details
/**
 * One row per audited HTTP request.  Written by `createAuditContextMiddleware`
 * before the handler runs, so the record exists even if the handler fails.
 *
 * Join to `db_mutation_audit_logs` on `request_id` to correlate DB mutations
 * with the business operation that caused them.
 */
export const auditRequestLogTable = pgTable(
    'audit_request_log',
    {
        id: publicId,
        requestId: text().notNull().unique(),
        traceId: text().notNull(),
        /** Semantic business operation name, e.g. `update_user`.  Derived from
         *  the route's `config.operation` field; falls back to `METHOD /route/pattern`. */
        operation: text().notNull(),
        actorId: text(),
        actorType: text({ enum: ACTOR_TYPE_VALUES }).notNull(),
        authSubject: text(),
        serviceName: text().notNull(),
        method: text().notNull(),
        url: text().notNull(),
        ip: text(),
        userAgent: text(),
        createdAt
    },
    (t) => [
        index('idx_audit_request_log_request_id').on(t.requestId),
        index('idx_audit_request_log_trace_id').on(t.traceId),
        index('idx_audit_request_log_operation').on(t.operation),
        index('idx_audit_request_log_actor_id').on(t.actorId),
        index('idx_audit_request_log_created_at').on(t.createdAt)
    ]
);

/**
 * One row per row-level mutation on audited tables.
 * Written exclusively by the `capture_db_mutation_audit` Postgres trigger —
 * the application never INSERTs here directly.
 *
 * Join to `audit_request_log` on `request_id` for full actor/trace context.
 */
export const dbMutationAuditLogsTable = pgTable(
    'db_mutation_audit_logs',
    {
        id: publicId,
        occurredAt: timestampTz().notNull().defaultNow(),
        txid: bigint({ mode: 'bigint' }).notNull(),
        schemaName: text().notNull(),
        tableName: text().notNull(),
        /** INSERT | UPDATE | DELETE */
        operation: text().notNull(),
        primaryKey: text(),
        oldRow: jsonb(),
        newRow: jsonb(),
        changedColumns: text().array(),
        /** FK → audit_request_log.request_id (SET NULL on delete) */
        requestId: text().references(() => auditRequestLogTable.requestId, { onDelete: 'set null' }),
        jobId: text()
    },
    (t) => [
        index('idx_db_mutation_audit_logs_request_id').on(t.requestId),
        index('idx_db_mutation_audit_table').on(t.tableName, t.occurredAt),
        index('idx_db_mutation_audit_txid').on(t.txid)
    ]
);

const auditResourceTypes = [
    'tenant',
    'organization',
    'api-key',
    'api-key-ip-whitelist',
    'user',
    'role',
    'contract',
    'contract-deployment',
    'contract-function-permission',
    'contract-event-permission',
    'contract-template',
    'contract-template-permission',
    'application',
    'm2m-app',
    'session',
    'service',
    'passkey',
    'passkey-challenge',
    'request'
] as const;
export const auditResourceTypeSchema = z.enum(auditResourceTypes);
export type CoreAuditResourceType = z.infer<typeof auditResourceTypeSchema>;
/** Same reasoning as `FeatureAuditAction`: the core records what it is handed, it does not list it. */
export type FeatureAuditResourceType = `${string}-${string}`;
export type AuditResourceType = CoreAuditResourceType | FeatureAuditResourceType;
