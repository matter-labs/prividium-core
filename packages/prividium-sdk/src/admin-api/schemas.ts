import { z } from 'zod';
import type { AdminUser } from './types.js';

const systemPermissionSchema = z.enum([
    'contract_deployment',
    'full_sequencer_rpc_access',
    'full_read_access',
    'admin_read',
    'admin_write',
    'org_users_manage',
    'org_wallets_manage',
    'org_rpc_access',
    'org_policy_access',
    'rpc_read_eth_getBlockByNumber',
    'rpc_read_eth_getLogs',
    'rpc_read_eth_getTransactionByHash',
    'rpc_read_eth_getTransactionReceipt',
    'check_user_read_access',
    'contract_metadata_read'
]);

const userWalletSchema = z.object({
    id: z.number(),
    walletAddress: z.string(),
    userId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
});

const userRoleSchema = z.object({
    id: z.string(),
    roleName: z.string(),
    systemPermissions: z.array(systemPermissionSchema).optional(),
    isSystemRole: z.boolean().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
});

const userOrganizationSchema = z.object({
    id: z.string(),
    name: z.string()
});

const userSourceSchema = z.enum(['oidc', 'adminPanel', 'tenant', 'crypto_native', 'm2m_app']);

// Mirrors the permissions-api user response, which omits server-owned secrets (walletToken) and
// external IdP identity (oidcSub/oidcIssuer); organizationId is redundant with `organization`.
export const adminUserSchema = z.object({
    id: z.string(),
    displayName: z.string(),
    source: userSourceSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    organization: userOrganizationSchema.nullable(),
    roles: z.array(userRoleSchema),
    wallets: z.array(userWalletSchema)
});

// Versioned user response shapes, following the pattern in cli/server/config-file.ts: `latest` is what
// a current permissions-api returns; each `v<X_Y>` entry is an older shape kept so the SDK keeps
// working against a server that predates a change. `adminUserResponseSchema` parses `latest` first,
// then older shapes, normalizing to `latest`. The strict `adminUserSchema` above stays the published
// contract and the type-alignment baseline.
const adminUserResponseShapes = {
    latest: adminUserSchema,
    // <= v1.260 (pre-surrogate-id): roles are keyed by name, so `id` is absent.
    v1_260: adminUserSchema.extend({ roles: z.array(userRoleSchema.extend({ id: z.string().optional() })) })
} as const;

export const adminUserResponseSchema = z.union([
    adminUserResponseShapes.latest,
    adminUserResponseShapes.v1_260.transform(
        (user): AdminUser => ({
            ...user,
            roles: user.roles.map((role) => ({ ...role, id: role.id ?? role.roleName }))
        })
    )
]);

const disclosedAddressSchema = z.object({ address: z.string() });

export const adminContractSchema = z.object({
    contractAddress: z.string(),
    abi: z.string(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    discloseErc20TotalSupply: z.boolean(),
    discloseBytecode: z.boolean(),
    templateId: z.number().nullable(),
    isSystemContract: z.boolean(),
    organizationId: z.string().nullable(),
    disclosedAddresses: z.array(disclosedAddressSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
    disclosureStartBlock: z.string()
});
