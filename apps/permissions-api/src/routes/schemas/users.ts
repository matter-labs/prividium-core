import { z } from 'zod/v4';
import { usersTable, walletsTable } from '../../db/schema';
import { displayNameField } from '../../repositories/shared-schemas';
import { createInsertSchema, createSelectSchema, MANAGED_COLUMNS } from '../../utils/drizzle-zod-schema-factory';
import { addressSchema } from '../../utils/schemas/address';
import { hexSchema } from '../../utils/schemas/hex-schema';
import { OrganizationSummarySchema } from './organizations';
import { BareRoleSchema, RoleSchema } from './roles';

const WalletSchema = createSelectSchema(walletsTable, { walletAddress: hexSchema }).omit({ deletedAt: true });

// walletToken is a server-owned secret; never accept it from the client
export const CreateUserBodySchema = createInsertSchema(usersTable, {
    displayName: displayNameField
})
    .omit({ ...MANAGED_COLUMNS, walletToken: true, suspendedAt: true })
    .extend({
        // role ids to assign
        roles: z.array(z.string()).optional(),
        wallets: z.array(addressSchema).optional()
    });

// A user response must never carry server-owned secrets or another user's external IdP identity.
// `walletToken` is a server-owned RPC credential (see CreateUserBodySchema above); `oidcSub`/`oidcIssuer`
// are the user's external identity; `organizationId` is redundant with the `organization` summary below.
// `source` is intentionally kept — adminv2 gates display-name editing on it.
const userResponseColumns = createSelectSchema(usersTable).omit({
    walletToken: true,
    oidcSub: true,
    oidcIssuer: true,
    organizationId: true
});

export const UserSchema = userResponseColumns.extend({
    organization: OrganizationSummarySchema.nullable(),
    roles: BareRoleSchema.array(),
    wallets: WalletSchema.array()
});

export const UserWithRolesSchema = userResponseColumns.extend({
    organization: OrganizationSummarySchema.nullable(),
    roles: RoleSchema.array(),
    wallets: WalletSchema.array()
});

export const WatchdogGrantSchema = z.object({
    rpcMethods: z.array(z.string()),
    calls: z.array(z.object({ contract: hexSchema, function: z.string(), ownRecipientOnly: z.boolean() })),
    events: z.array(z.object({ contract: hexSchema, event: z.string(), ownSenderOnly: z.boolean() }))
});

export const UpdateUserBodySchema = CreateUserBodySchema.pick({
    displayName: true,
    roles: true,
    wallets: true
}).required();
