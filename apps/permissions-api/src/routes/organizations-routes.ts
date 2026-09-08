import { AUDIT_ACTIONS, hasSystemPermission, hasZoneSystemPermission } from '@repo/access-control';
import type { FastifyRequest } from 'fastify';
import type { Hex } from 'viem';
import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { auditActionTypeSchema } from '../db/schema';
import { requireOrgAdmin } from '../middleware/require-org-admin';
import { requireM2mAppOrgAssociation, requireOrgAdminForUserCaller } from '../middleware/require-org-membership';
import type { SessionsAuthValidator } from '../middleware/sessions-auth';
import { SelectAuditLogSchema } from '../repositories/audit-logs-repository';
import {
    fullContractPermissionSchema,
    newContractPermissionSchema,
    updateContractPermissionSchema
} from '../repositories/contract-function-permissions-repository';
import {
    contractsByTemplateResponseSchema,
    createContractSchema,
    fullContractSchema,
    groupedContractsResponseSchema,
    updateContractSchema
} from '../repositories/contracts-repository';
import { displayNameField } from '../repositories/shared-schemas';
import type { ExternalRpc } from '../rpc/target-rpc';
import type { ApiKeyService } from '../services/api-key-service';
import { assertOrgContractRegisterable } from '../services/contract-registration-guard';
import type { M2mAppActionsService } from '../services/m2m-app-actions-service';
import { deleteOrganizationAndRevokeAccess } from '../services/organizations-service';
import { isSystemContractAddress } from '../services/system-contracts/registry';
import { withOverbroadFlag } from '../utils/cidr';
import { EntityNotFound, ForbiddenError, InvalidInputError, OrgQuotaExceededError } from '../utils/error-types';
import { areHexEqual } from '../utils/hex';
import { orgCountGauge } from '../utils/metrics';
import { assertValidJwksUri, assertValidUserPanelUrl } from '../utils/oidc-provider-validation';
import { addressSchema } from '../utils/schemas/address';
import { ErrorResponseSchema, PaginationQuerySchema, SearchQuerySchema } from '../utils/schemas/fastify-common';
import { paginatedResult } from '../utils/schemas/pagination';
import { createApiKeyBodySchema, OrgApiKeyWithSecretSchema, PaginatedOrgApiKeysSchema } from './schemas/api-keys';
import {
    CreateEventPermissionBodySchema,
    EventPermissionSchema,
    PaginatedEventPermissionsSchema,
    UpdateEventPermissionBodySchema
} from './schemas/contract-event-permissions';
import {
    CreateIpWhitelistBodySchema,
    OrgIpWhitelistSchema,
    PaginatedOrgIpWhitelistSchema
} from './schemas/ip-whitelist';
import {
    CreateOrgM2mApplicationBodySchema,
    OrgM2mApplicationSchema,
    PaginatedOrgM2mApplicationsSchema,
    UpdateOrgM2mApplicationBodySchema
} from './schemas/m2m-applications';
import { OidcProviderSchema, SetOidcProviderBodySchema } from './schemas/oidc-providers';
import { CreateOrgPendingAdminBodySchema, OrgPendingAdminSchema } from './schemas/org-pending-admins';
import {
    CreateOrganizationBodySchema,
    OrganizationSchema,
    UpdateBrandingBodySchema,
    UpdateOrganizationBodySchema,
    UpdateSiweSettingsBodySchema
} from './schemas/organizations';
import { CreateRoleBodySchema, RoleSchema, RoleWithCountsSchema } from './schemas/roles';
import { WalletAddressSchema } from './schemas/tenants';
import { UserSchema } from './schemas/users';

const byIdSchema = z.object({
    id: z.string()
});

const addUserBodySchema = z.object({
    userId: z.string()
});

const inviteMemberBodySchema = z.object({
    oidcSub: z.string().min(1),
    displayName: displayNameField
});

const pendingAdminParamsSchema = z.object({
    id: z.string(),
    oidcSub: z.string()
});

type Deps = {
    sessionAuthValidator: SessionsAuthValidator;
    m2mAppActionsService: M2mAppActionsService;
    chainRpc: ExternalRpc;
    apiKeyService: ApiKeyService;
    apiKeyMaxExpirationSeconds: number;
    insecureM2mAllowAnyIp: boolean;
    operatorIssuer?: string;
    maxOrganizations: number;
    multiOrgEnabled: boolean;
};

const orgAuditLogsQuerySchema = PaginationQuerySchema().extend({
    userId: z.string().optional(),
    actionType: auditActionTypeSchema.optional(),
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional()
});

const orgAuditLogSchema = SelectAuditLogSchema.extend({ operatorBypass: z.boolean() });

const orgRoleParamsSchema = z.object({ id: z.string(), roleId: z.string().min(1) });
const orgRolesListQuerySchema = PaginationQuerySchema().extend({ searchQuery: SearchQuerySchema.optional() });

const orgContractParamsSchema = z.object({ id: z.string(), contractAddress: addressSchema });
const orgM2mAppParamsSchema = z.object({ id: z.string(), appId: z.string() });
// Owner is bound from the path, never the body.
const createOrgIpWhitelistBodySchema = CreateIpWhitelistBodySchema.omit({ tenantId: true, m2mAppId: true });
const orgContractByTemplateParamsSchema = z.object({ id: z.string(), templateId: z.coerce.number().int() });
const orgContractsListQuerySchema = PaginationQuerySchema({ limit: { max: 100 } }).extend({
    searchQuery: SearchQuerySchema.optional()
});
const orgContractsByTemplateQuerySchema = PaginationQuerySchema({ limit: { max: 1000 } }).extend({
    searchQuery: SearchQuerySchema.optional()
});
// Owner org comes from the path :id and is never taken from the body. Selective disclosure exposes
// an address to unauthenticated callers, so it stays a zone-operator decision: the fields are
// omitted here and pinned in the handlers.
const disclosureFields = {
    discloseBytecode: true,
    discloseErc20TotalSupply: true,
    disclosedAddresses: true,
    disclosureStartBlock: true
} as const;
const createOrgContractSchema = createContractSchema.omit({ organizationId: true, ...disclosureFields });
const updateOrgContractSchema = updateContractSchema.omit(disclosureFields);
// Disclosure stays off, so the start block is never read; 0x0 avoids implying a floor that
// nothing enforces.
// Required rather than the schema's input shape: the update path takes these as concrete values.
const ORG_CONTRACT_DISCLOSURE_DEFAULTS: Required<
    Pick<
        z.input<typeof createContractSchema>,
        'discloseBytecode' | 'discloseErc20TotalSupply' | 'disclosedAddresses' | 'disclosureStartBlock'
    >
> = {
    discloseBytecode: false,
    discloseErc20TotalSupply: false,
    disclosedAddresses: [],
    disclosureStartBlock: '0x0'
};

const orgFunctionPermissionParamsSchema = orgContractParamsSchema.extend({
    permissionId: z.coerce.number().int()
});
const orgEventPermissionParamsSchema = orgContractParamsSchema.extend({ eventPermissionId: z.string() });
const orgContractPermissionsListQuerySchema = PaginationQuerySchema({ limit: { max: 1000 } });
// `organizationOnly` is omitted here and forced on in the handlers, so an org admin can't open a function zone-wide.
// `isUmbrella` is omitted and forced off the same way: it stops the judge from walking inner call
// frames, which is a zone-operator decision.
const createOrgFunctionPermissionSchema = newContractPermissionSchema.omit({
    contractAddress: true,
    organizationOnly: true,
    isUmbrella: true
});
const updateOrgFunctionPermissionSchema = updateContractPermissionSchema.omit({
    contractAddress: true,
    organizationOnly: true,
    isUmbrella: true,
    id: true
});
const createOrgEventPermissionSchema = CreateEventPermissionBodySchema.omit({
    contractAddress: true,
    organizationOnly: true
});
const updateOrgEventPermissionSchema = UpdateEventPermissionBodySchema.omit({
    contractAddress: true,
    organizationOnly: true
});

export function organizationsRoutes(
    server: FastifyServer,
    {
        sessionAuthValidator,
        m2mAppActionsService,
        chainRpc,
        apiKeyService,
        apiKeyMaxExpirationSeconds,
        insecureM2mAllowAnyIp,
        operatorIssuer,
        maxOrganizations,
        multiOrgEnabled
    }: Deps
) {
    const roleScope = { allowZoneRoles: !multiOrgEnabled };

    // Admin-only routes
    server.register((server: FastifyServer) => {
        server.addHook(
            'onRequest',
            sessionAuthValidator.buildHook((request) => ({
                targets: [
                    {
                        type: 'user',
                        ...(request.method === 'GET'
                            ? { requiredSystemPermissions: ['admin_read'] }
                            : { requiredSystemPermissions: ['admin_write'] })
                    }
                ]
            }))
        );

        server.post(
            '/',
            {
                schema: {
                    description: 'Creates a new organization',
                    tags: ['organizations'],
                    body: CreateOrganizationBodySchema,
                    response: {
                        200: OrganizationSchema,
                        400: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema,
                        409: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                if ((await req.repos.organizations.countNonDeleted()) >= maxOrganizations) {
                    throw new OrgQuotaExceededError(maxOrganizations);
                }
                const organization = await req.repos.organizations.create(req.body, roleScope);
                orgCountGauge.inc();
                return reply.send(organization);
            }
        );

        server.get(
            '/',
            {
                schema: {
                    description: 'Search organizations with pagination',
                    tags: ['organizations'],
                    querystring: PaginationQuerySchema(),
                    response: {
                        200: paginatedResult(OrganizationSchema),
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const result = await req.repos.organizations.searchPaginated(req.query);
                return reply.send(result);
            }
        );

        server.get(
            '/:id',
            {
                schema: {
                    description: 'Get organization by id',
                    tags: ['organizations'],
                    params: byIdSchema,
                    response: {
                        200: OrganizationSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const organization = await req.repos.organizations.getById(req.params.id);
                return reply.send(organization);
            }
        );

        server.put(
            '/:id',
            {
                schema: {
                    description: 'Update an organization by id',
                    tags: ['organizations'],
                    params: byIdSchema,
                    body: UpdateOrganizationBodySchema,
                    response: {
                        200: OrganizationSchema,
                        400: ErrorResponseSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const organization = await req.repos.organizations.update(req.params.id, req.body, roleScope);
                return reply.send(organization);
            }
        );

        server.delete(
            '/:id',
            {
                config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_DELETE },
                schema: {
                    description:
                        "Soft-delete an organization, revoking its members' sessions and the API keys of the credentials it owns",
                    tags: ['organizations'],
                    params: byIdSchema,
                    response: {
                        204: z.void(),
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const revoked = await deleteOrganizationAndRevokeAccess(
                    req.repos,
                    req.params.id,
                    req.auth.currentUser().id
                );
                orgCountGauge.dec();

                // The triggers snapshot each revoked row but not the cause; the counts tie them to this delete.
                req.auditEventDetails = {
                    resourceType: 'organization',
                    resourceId: req.params.id,
                    actionDetails: revoked
                };

                return reply.status(204).send();
            }
        );

        server.post(
            '/:id/users',
            {
                schema: {
                    description: 'Assign a user to an organization',
                    tags: ['organizations', 'users'],
                    params: byIdSchema,
                    body: addUserBodySchema,
                    response: {
                        200: UserSchema,
                        400: ErrorResponseSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema,
                        409: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const user = await req.repos.organizations.addUser(req.params.id, req.body.userId, roleScope);
                return reply.send(user);
            }
        );

        server.put(
            '/:id/oidc-provider',
            {
                config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_OIDC_PROVIDER_SET },
                schema: {
                    description: "Set (create or replace) an organization's OIDC identity provider",
                    tags: ['organizations', 'oidc'],
                    params: byIdSchema,
                    body: SetOidcProviderBodySchema,
                    response: {
                        200: OidcProviderSchema,
                        400: ErrorResponseSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema,
                        409: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                await req.repos.organizations.getById(req.params.id);
                if (operatorIssuer && req.body.issuer === operatorIssuer) {
                    throw new InvalidInputError('issuer must not match the operator issuer');
                }
                assertValidJwksUri(req.body.jwksUri);
                assertValidUserPanelUrl(req.body.userPanelUrl);
                const provider = await req.repos.oidcProviders.upsert({ organizationId: req.params.id, ...req.body });
                return reply.send(provider);
            }
        );

        server.delete(
            '/:id/oidc-provider',
            {
                config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_OIDC_PROVIDER_DELETE },
                schema: {
                    description: "Remove an organization's OIDC identity provider",
                    tags: ['organizations', 'oidc'],
                    params: byIdSchema,
                    response: {
                        204: z.void(),
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                await req.repos.oidcProviders.deleteById(req.params.id);
                return reply.status(204).send();
            }
        );

        server.get(
            '/:id/oidc-provider/config',
            {
                schema: {
                    description: "Get an organization's full OIDC provider configuration for the operator view",
                    tags: ['organizations', 'oidc'],
                    params: byIdSchema,
                    response: {
                        200: OidcProviderSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                await req.repos.organizations.getById(req.params.id);
                const provider = await req.repos.oidcProviders.getById(req.params.id);
                return reply.send(provider);
            }
        );

        server.put(
            '/:id/siwe-settings',
            {
                config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_SIWE_SETTINGS_UPDATE },
                schema: {
                    description:
                        "Set an organization's SIWE wallet-login settings. When enabled, the host of the org's OIDC userPanelUrl plus the extra allowed domains become valid SIWE domains for the org's login challenges (authenticated wallet-association challenges accept them regardless).",
                    tags: ['organizations', 'siwe'],
                    params: byIdSchema,
                    body: UpdateSiweSettingsBodySchema,
                    response: {
                        200: OrganizationSchema,
                        400: ErrorResponseSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const organization = await req.repos.organizations.updateSiweSettings(req.params.id, req.body);
                return reply.send(organization);
            }
        );

        server.post(
            '/:id/pending-admins',
            {
                config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_PENDING_ADMIN_ADD },
                schema: {
                    description: "Pre-seed an organization's first admin by OIDC sub (consumed on their first login)",
                    tags: ['organizations', 'pending-admins'],
                    params: byIdSchema,
                    body: CreateOrgPendingAdminBodySchema,
                    response: {
                        200: OrgPendingAdminSchema,
                        400: ErrorResponseSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema,
                        409: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                await req.repos.organizations.getById(req.params.id);
                const pendingAdmin = await req.repos.orgPendingAdmins.create({
                    organizationId: req.params.id,
                    oidcSub: req.body.oidcSub
                });
                return reply.send(pendingAdmin);
            }
        );

        server.get(
            '/:id/pending-admins',
            {
                schema: {
                    description: 'List the pending admins seeded for an organization',
                    tags: ['organizations', 'pending-admins'],
                    params: byIdSchema,
                    response: {
                        200: OrgPendingAdminSchema.array(),
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                await req.repos.organizations.getById(req.params.id);
                const pendingAdmins = await req.repos.orgPendingAdmins.findByOrganization(req.params.id);
                return reply.send(pendingAdmins);
            }
        );

        server.delete(
            '/:id/pending-admins/:oidcSub',
            {
                config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_PENDING_ADMIN_REMOVE },
                schema: {
                    description: 'Remove a pending admin from an organization',
                    tags: ['organizations', 'pending-admins'],
                    params: pendingAdminParamsSchema,
                    response: {
                        204: z.void(),
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                await req.repos.orgPendingAdmins.deleteByOrganizationAndSub(req.params.id, req.params.oidcSub);
                return reply.status(204).send();
            }
        );
    });

    // M2M app routes
    const orgIdParams = z.object({ id: z.string() });
    const userIdParams = z.object({ id: z.string(), userId: z.string() });

    server.register((server: FastifyServer) => {
        server.addHook(
            'onRequest',
            sessionAuthValidator.buildHook({
                targets: [{ type: 'm2m_app' }]
            })
        );

        server.addHook('preHandler', requireM2mAppOrgAssociation);

        server.post(
            '/:id/users/create',
            {
                config: { audit_action: AUDIT_ACTIONS.M2M_APP_USER_CREATE },
                schema: {
                    description: 'Creates a user in the specified organization',
                    tags: ['m2m-app-actions'],
                    params: orgIdParams,
                    body: z.object({
                        displayName: z.string(),
                        walletAddresses: WalletAddressSchema.array().optional().default([])
                    }),
                    response: {
                        200: UserSchema,
                        400: ErrorResponseSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        409: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const m2mApp = req.auth.currentM2mApp();
                if (!hasSystemPermission(m2mApp, 'org_users_manage', req.params.id)) {
                    throw new ForbiddenError('Missing permission: org_users_manage');
                }
                if (
                    req.body.walletAddresses.length > 0 &&
                    !hasSystemPermission(m2mApp, 'org_wallets_manage', req.params.id)
                ) {
                    throw new ForbiddenError('Missing permission: org_wallets_manage');
                }
                const user = await m2mAppActionsService.createUser(req.params.id, req.body);
                return reply.send(user);
            }
        );

        // POST /:id/users/:userId/wallets
        server.post(
            '/:id/users/:userId/wallets',
            {
                config: { audit_action: AUDIT_ACTIONS.M2M_APP_WALLET_ASSOCIATE },
                schema: {
                    description: 'Attaches wallets to a user in the specified organization',
                    tags: ['m2m-app-actions'],
                    params: userIdParams,
                    body: WalletAddressSchema.array(),
                    response: {
                        200: UserSchema,
                        400: ErrorResponseSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema,
                        409: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const m2mApp = req.auth.currentM2mApp();
                if (!hasSystemPermission(m2mApp, 'org_wallets_manage', req.params.id)) {
                    throw new ForbiddenError('Missing permission: org_wallets_manage');
                }
                const user = await m2mAppActionsService.addWalletsToUser(req.params.id, req.params.userId, req.body);
                return reply.send(user);
            }
        );
    });

    // Org members list — readable by a zone operator (any org), an org admin (own org only), or an
    // associated M2M app. The user target only authenticates; requireOrgAdmin makes the
    // zone-operator-or-own-org-admin decision (a peer org gets a 403 that never leaks its existence).
    // The M2M path is gated by org association below plus the org_users_manage check in the handler.
    server.register((server: FastifyServer) => {
        server.addHook(
            'onRequest',
            sessionAuthValidator.buildHook({
                targets: [{ type: 'user' }, { type: 'm2m_app' }]
            })
        );

        server.addHook('preHandler', requireM2mAppOrgAssociation);
        server.addHook('preHandler', requireOrgAdminForUserCaller);

        server.get(
            '/:id/users',
            {
                schema: {
                    description: 'Lists users in the specified organization',
                    tags: ['m2m-app-actions'],
                    params: orgIdParams,
                    querystring: PaginationQuerySchema().extend({
                        displayName: z.string().optional(),
                        roleId: z.string().optional()
                    }),
                    response: {
                        200: paginatedResult(UserSchema),
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                if (req.auth.type === 'm2m_app') {
                    const m2mApp = req.auth.currentM2mApp();
                    if (!hasSystemPermission(m2mApp, 'org_users_manage', req.params.id)) {
                        throw new ForbiddenError('Missing permission: org_users_manage');
                    }
                }
                const users = await req.repos.organizations.usersFor(req.params.id, req.query);
                return reply.send(users);
            }
        );
    });

    server.register((server: FastifyServer) => {
        server.addHook('onRequest', sessionAuthValidator.buildHook({ targets: [{ type: 'user' }] }));
        server.addHook('preHandler', requireOrgAdmin);

        server.get(
            '/:id/users/:userId',
            {
                schema: {
                    description: 'Get a single member of the organization',
                    tags: ['organizations', 'users'],
                    params: userIdParams,
                    response: {
                        200: UserSchema,
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                const member = await req.repos.organizations.getMember(req.params.id, req.params.userId);
                return reply.send(member);
            }
        );

        // Removing a member only clears their org membership (soft); requireOrgAdmin lets a zone
        // operator do this on any org and an org admin only on their own. A non-member 404s like a
        // peer org's member would, so cross-org membership never leaks.
        server.delete(
            '/:id/users/:userId',
            {
                config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_USER_REMOVE },
                schema: {
                    description: 'Remove a member from an organization',
                    tags: ['organizations', 'users'],
                    params: userIdParams,
                    response: {
                        204: z.void(),
                        401: ErrorResponseSchema,
                        403: ErrorResponseSchema,
                        404: ErrorResponseSchema
                    }
                }
            },
            async (req, reply) => {
                await req.repos.organizations.removeUser(req.params.id, req.params.userId);
                return reply.status(204).send();
            }
        );
    });

    if (multiOrgEnabled) {
        server.register((server: FastifyServer) => {
            server.addHook('onRequest', sessionAuthValidator.buildHook({ targets: [{ type: 'user' }] }));
            server.addHook('preHandler', requireOrgAdmin);

            // Pre-authorizes a member by OIDC subject: an org-scoped account with a null issuer, claimed on
            // their first login via the org IdP. 409 if the subject already exists.
            server.post(
                '/:id/users/invite',
                {
                    config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_USER_ADD },
                    schema: {
                        description: 'Pre-authorize a member by OIDC subject (claimed on first login via the org IdP)',
                        tags: ['organizations', 'users'],
                        params: byIdSchema,
                        body: inviteMemberBodySchema,
                        response: {
                            200: UserSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema,
                            409: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    const member = await req.repos.organizations.inviteMemberByOidcSub(req.params.id, req.body);
                    return reply.send(member);
                }
            );

            server.put(
                '/:id/users/:userId/roles',
                {
                    config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_USER_ROLES_UPDATE },
                    schema: {
                        description: "Set a member's organization-scoped roles",
                        tags: ['organizations', 'users', 'roles'],
                        params: userIdParams,
                        body: z.object({ roles: z.array(z.string()) }),
                        response: {
                            200: UserSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    const member = await req.repos.organizations.setMemberRoles(
                        req.params.id,
                        req.params.userId,
                        req.body.roles,
                        // requireOrgAdmin admits zone operators too, and they are not bound by the ceiling.
                        { allowOverCeilingRoles: hasZoneSystemPermission(req.auth.currentUser(), 'admin_write') }
                    );
                    return reply.send(member);
                }
            );

            server.get(
                '/:id/admins',
                {
                    schema: {
                        description: 'List the admins of an organization',
                        tags: ['organizations', 'admins'],
                        params: byIdSchema,
                        response: {
                            200: UserSchema.array(),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    const admins = await req.repos.organizations.listAdmins(req.params.id);
                    return reply.send(admins);
                }
            );

            server.patch(
                '/:id',
                {
                    config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_BRANDING_UPDATE },
                    schema: {
                        description: "Update an organization's branding (name, logo, colors)",
                        tags: ['organizations'],
                        params: byIdSchema,
                        body: UpdateBrandingBodySchema,
                        response: {
                            200: OrganizationSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    const organization = await req.repos.organizations.updateBranding(req.params.id, req.body);
                    return reply.send(organization);
                }
            );

            server.get(
                '/:id/audit-logs',
                {
                    schema: {
                        description: "Paginated, filterable view of the organization's audit log",
                        tags: ['organizations', 'audit-logs'],
                        params: byIdSchema,
                        querystring: orgAuditLogsQuerySchema,
                        response: {
                            200: paginatedResult(orgAuditLogSchema),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const { limit, offset, userId, actionType, startDate, endDate } = req.query;
                    const result = await req.repos.auditLogs.findPaginated(
                        { activeOrganizationId: req.params.id, userId, actionType, startDate, endDate },
                        { limit, offset }
                    );
                    const actorIds = [
                        ...new Set(
                            result.items.map((log) => log.activeUserId).filter((id): id is string => id !== null)
                        )
                    ];
                    const actorOrg = await req.repos.users.organizationIdByIds(actorIds);
                    const items = result.items.map((log) => ({
                        ...log,
                        // Zone-level actor (org null) = zone operator via support bypass; unknown actors aren't flagged.
                        operatorBypass:
                            log.actorType === 'user' &&
                            log.activeUserId !== null &&
                            actorOrg.get(log.activeUserId) === null
                    }));
                    return reply.send({ items, pagination: result.pagination });
                }
            );

            server.post(
                '/:id/sessions/revoke',
                {
                    config: { audit_action: AUDIT_ACTIONS.ORGANIZATION_SESSIONS_REVOKE },
                    schema: {
                        description: "Revoke all active sessions of the organization's users",
                        tags: ['organizations', 'sessions'],
                        params: byIdSchema,
                        response: {
                            200: z.object({ revoked: z.number().int().nonnegative() }),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const revoked = await req.repos.sessions.revokeAllByOrganizationId(
                        req.params.id,
                        req.auth.currentUser().id
                    );
                    return reply.send({ revoked });
                }
            );

            server.get(
                '/:id/roles',
                {
                    schema: {
                        description: "List an organization's custom roles",
                        tags: ['organizations', 'roles'],
                        params: byIdSchema,
                        querystring: orgRolesListQuerySchema,
                        response: {
                            200: paginatedResult(RoleWithCountsSchema),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const result = await req.repos.roles.findPaginated({ ...req.query, organizationId: req.params.id });
                    return reply.send(result);
                }
            );

            server.post(
                '/:id/roles',
                {
                    config: { audit_action: AUDIT_ACTIONS.ROLE_CREATE },
                    schema: {
                        description: 'Create a custom role scoped to the organization',
                        tags: ['organizations', 'roles'],
                        params: byIdSchema,
                        body: CreateRoleBodySchema,
                        response: {
                            201: RoleSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema,
                            409: ErrorResponseSchema,
                            422: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const role = await req.repos.roles.create(req.body, { organizationId: req.params.id });
                    return reply.status(201).send(role);
                }
            );

            server.get(
                '/:id/roles/:roleId',
                {
                    schema: {
                        description: "Get one of an organization's custom roles by id",
                        tags: ['organizations', 'roles'],
                        params: orgRoleParamsSchema,
                        response: {
                            200: RoleSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    const role = await req.repos.roles.findScoped(req.params.roleId, { organizationId: req.params.id });
                    if (role === undefined) {
                        throw new EntityNotFound('Role', { id: req.params.roleId });
                    }
                    return reply.send(role);
                }
            );

            server.get(
                '/:id/roles/:roleId/function-permissions',
                {
                    schema: {
                        description: "List the function permissions one of the organization's roles grants",
                        tags: ['organizations', 'roles', 'contract-permissions'],
                        params: orgRoleParamsSchema,
                        querystring: orgContractPermissionsListQuerySchema,
                        response: {
                            200: paginatedResult(fullContractPermissionSchema),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsRole(req, req.params.id, req.params.roleId);
                    const result = await req.repos.contractFunctionPermissions.findPaginated(
                        { roleId: req.params.roleId, organizationId: req.params.id },
                        req.query
                    );
                    return reply.send(result);
                }
            );

            server.put(
                '/:id/roles/:roleId',
                {
                    config: { audit_action: AUDIT_ACTIONS.ROLE_UPDATE },
                    schema: {
                        description: "Replace an organization role's permissions",
                        tags: ['organizations', 'roles'],
                        params: orgRoleParamsSchema,
                        body: CreateRoleBodySchema,
                        response: {
                            200: RoleSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    const role = await req.repos.roles.updateScoped(req.params.roleId, req.body, {
                        organizationId: req.params.id
                    });
                    if (role === undefined) {
                        throw new EntityNotFound('Role', { id: req.params.roleId });
                    }
                    return reply.send(role);
                }
            );

            server.delete(
                '/:id/roles/:roleId',
                {
                    config: { audit_action: AUDIT_ACTIONS.ROLE_DELETE },
                    schema: {
                        description: "Delete one of an organization's custom roles",
                        tags: ['organizations', 'roles'],
                        params: orgRoleParamsSchema,
                        response: {
                            204: z.void(),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema,
                            422: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    const deleted = await req.repos.roles.deleteScoped(req.params.roleId, {
                        organizationId: req.params.id
                    });
                    if (!deleted) {
                        throw new EntityNotFound('Role', { id: req.params.roleId });
                    }
                    return reply.status(204).send();
                }
            );

            server.get(
                '/:id/m2m-applications',
                {
                    schema: {
                        description:
                            'List the M2M credentials visible to the organization: its own credentials plus zone-level credentials the operator assigned to it.',
                        tags: ['organizations', 'm2m-applications'],
                        params: byIdSchema,
                        querystring: PaginationQuerySchema(),
                        response: {
                            200: PaginatedOrgM2mApplicationsSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const result = await req.repos.m2mApps.searchPaginatedForOrg(req.params.id, req.query);
                    return reply.send(result);
                }
            );

            server.post(
                '/:id/m2m-applications',
                {
                    config: { audit_action: AUDIT_ACTIONS.M2M_APP_CREATE },
                    schema: {
                        description: 'Create an M2M credential owned by the organization',
                        tags: ['organizations', 'm2m-applications'],
                        params: byIdSchema,
                        body: CreateOrgM2mApplicationBodySchema,
                        response: {
                            201: OrgM2mApplicationSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const app = await req.repos.m2mApps.createForOrg(req.params.id, req.body);
                    return reply.status(201).send(app);
                }
            );

            server.put(
                '/:id/m2m-applications/:appId',
                {
                    config: { audit_action: AUDIT_ACTIONS.M2M_APP_UPDATE },
                    schema: {
                        description:
                            "Update an org-owned M2M credential's settings and role/permission selection (within the org-admin ceiling). A credential the org does not own returns 404.",
                        tags: ['organizations', 'm2m-applications'],
                        params: z.object({ id: z.string(), appId: z.string() }),
                        body: UpdateOrgM2mApplicationBodySchema,
                        response: {
                            200: OrgM2mApplicationSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const app = await req.repos.m2mApps.updateForOrg(req.params.id, req.params.appId, req.body);
                    return reply.send(app);
                }
            );

            server.delete(
                '/:id/m2m-applications/:appId',
                {
                    config: { audit_action: AUDIT_ACTIONS.M2M_APP_DELETE },
                    schema: {
                        description:
                            'Delete an org-owned M2M credential. Zone-level credentials are operator-delete-only; a credential the org does not own returns 404.',
                        tags: ['organizations', 'm2m-applications'],
                        params: z.object({ id: z.string(), appId: z.string() }),
                        response: {
                            204: z.void(),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    await req.repos.m2mApps.deleteForOrg(req.params.id, req.params.appId);
                    return reply.status(204).send();
                }
            );

            server.get(
                '/:id/m2m-applications/:appId',
                {
                    schema: {
                        description:
                            'Get one of the M2M credentials visible to the organization: its own, or a zone-level one assigned to it. Anything else returns 404.',
                        tags: ['organizations', 'm2m-applications'],
                        params: orgM2mAppParamsSchema,
                        response: {
                            200: OrgM2mApplicationSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const app = await req.repos.m2mApps.getVisibleToOrg(req.params.id, req.params.appId);
                    return reply.send(app);
                }
            );

            server.get(
                '/:id/m2m-applications/:appId/api-keys',
                {
                    schema: {
                        description: 'List the API keys of an org-owned M2M credential',
                        tags: ['organizations', 'm2m-app-api-keys'],
                        params: orgM2mAppParamsSchema,
                        querystring: PaginationQuerySchema(),
                        response: {
                            200: PaginatedOrgApiKeysSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsM2mApp(req, req.params.id, req.params.appId);
                    const result = await req.repos.apiKeys.findByM2mAppId(req.params.appId, req.query);
                    return reply.send({ ...result, items: result.items.map(omitKeyHash) });
                }
            );

            server.post(
                '/:id/m2m-applications/:appId/api-keys',
                {
                    config: { audit_action: AUDIT_ACTIONS.API_KEY_CREATE },
                    schema: {
                        description:
                            'Create an API key for an org-owned M2M credential (the full key is returned only once)',
                        tags: ['organizations', 'm2m-app-api-keys'],
                        params: orgM2mAppParamsSchema,
                        body: createApiKeyBodySchema(apiKeyMaxExpirationSeconds),
                        response: {
                            201: OrgApiKeyWithSecretSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsM2mApp(req, req.params.id, req.params.appId);
                    const { fullKey, keyHash, keyPrefix } = apiKeyService.generate();
                    const created = await req.repos.apiKeys.create({
                        m2mAppId: req.params.appId,
                        name: req.body.name,
                        keyHash,
                        keyPrefix,
                        expiresAt: req.body.expiresAt
                    });
                    return reply.status(201).send({ ...omitKeyHash(created), fullKey });
                }
            );

            server.delete(
                '/:id/m2m-applications/:appId/api-keys/:keyId',
                {
                    config: { audit_action: AUDIT_ACTIONS.API_KEY_REVOKE },
                    schema: {
                        description: 'Revoke an API key of an org-owned M2M credential',
                        tags: ['organizations', 'm2m-app-api-keys'],
                        params: orgM2mAppParamsSchema.extend({ keyId: z.string() }),
                        response: {
                            204: z.void(),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsM2mApp(req, req.params.id, req.params.appId);
                    await req.repos.apiKeys.revokeForM2mApp(req.params.keyId, req.params.appId);
                    return reply.status(204).send();
                }
            );

            server.get(
                '/:id/m2m-applications/:appId/ip-whitelist',
                {
                    schema: {
                        description: 'List the IP whitelist of an org-owned M2M credential',
                        tags: ['organizations', 'm2m-app-ip-whitelist'],
                        params: orgM2mAppParamsSchema,
                        querystring: PaginationQuerySchema(),
                        response: {
                            200: PaginatedOrgIpWhitelistSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsM2mApp(req, req.params.id, req.params.appId);
                    const result = await req.repos.ipWhitelist.findByM2mAppId(req.params.appId, req.query);
                    return reply.send({ items: result.items.map(withOverbroadFlag), pagination: result.pagination });
                }
            );

            server.post(
                '/:id/m2m-applications/:appId/ip-whitelist',
                {
                    config: { audit_action: AUDIT_ACTIONS.IP_WHITELIST_CREATE },
                    schema: {
                        description: "Add an IP address to an org-owned M2M credential's whitelist",
                        tags: ['organizations', 'm2m-app-ip-whitelist'],
                        params: orgM2mAppParamsSchema,
                        body: createOrgIpWhitelistBodySchema,
                        response: {
                            201: OrgIpWhitelistSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema,
                            409: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsM2mApp(req, req.params.id, req.params.appId);
                    const created = await req.repos.ipWhitelist.create(
                        {
                            m2mAppId: req.params.appId,
                            ipAddress: req.body.ipAddress,
                            description: req.body.description
                        },
                        { allowAnyCidr: insecureM2mAllowAnyIp }
                    );
                    return reply.status(201).send(withOverbroadFlag(created));
                }
            );

            server.delete(
                '/:id/m2m-applications/:appId/ip-whitelist/:entryId',
                {
                    config: { audit_action: AUDIT_ACTIONS.IP_WHITELIST_DELETE },
                    schema: {
                        description: "Remove an IP address from an org-owned M2M credential's whitelist",
                        tags: ['organizations', 'm2m-app-ip-whitelist'],
                        params: orgM2mAppParamsSchema.extend({ entryId: z.string() }),
                        response: {
                            204: z.void(),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsM2mApp(req, req.params.id, req.params.appId);
                    await req.repos.ipWhitelist.deleteForM2mApp(req.params.entryId, req.params.appId);
                    return reply.status(204).send();
                }
            );

            server.get(
                '/:id/contracts',
                {
                    schema: {
                        description:
                            "List the organization's contracts grouped by template. Returns template groups (with counts) followed by ungrouped contracts.",
                        tags: ['organizations', 'contracts'],
                        params: byIdSchema,
                        querystring: orgContractsListQuerySchema,
                        response: {
                            200: groupedContractsResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const result = await req.repos.contracts.findGrouped({
                        organizationId: req.params.id,
                        ...req.query
                    });
                    return reply.send(result);
                }
            );

            server.get(
                '/:id/contracts/by-template/:templateId',
                {
                    schema: {
                        description: "List one of the organization's contracts for a specific template with pagination",
                        tags: ['organizations', 'contracts'],
                        params: orgContractByTemplateParamsSchema,
                        querystring: orgContractsByTemplateQuerySchema,
                        response: {
                            200: contractsByTemplateResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const result = await req.repos.contracts.findByTemplatePaginated({
                        templateId: req.params.templateId,
                        organizationId: req.params.id,
                        ...req.query
                    });
                    return reply.send(result);
                }
            );

            server.post(
                '/:id/contracts',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_CREATE },
                    schema: {
                        description: 'Register a contract owned by the organization',
                        tags: ['organizations', 'contracts'],
                        params: byIdSchema,
                        body: createOrgContractSchema,
                        response: {
                            201: fullContractSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema,
                            409: ErrorResponseSchema,
                            503: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    if (isSystemContractAddress(req.body.contractAddress)) {
                        throw new InvalidInputError('Cannot create a contract at a system contract address');
                    }
                    await assertTemplateHasNoUmbrella(req, req.body);
                    await assertOrgContractRegisterable(req.body.contractAddress, {
                        chainRpc,
                        repos: req.repos,
                        organizationId: req.params.id,
                        caller: req.auth.currentUser()
                    });
                    const contract = await req.repos.contracts.create({
                        ...req.body,
                        ...ORG_CONTRACT_DISCLOSURE_DEFAULTS,
                        organizationId: req.params.id
                    });
                    return reply.status(201).send(contract);
                }
            );

            server.get(
                '/:id/contracts/:contractAddress',
                {
                    schema: {
                        description: "Get one of the organization's contracts by address",
                        tags: ['organizations', 'contracts'],
                        params: orgContractParamsSchema,
                        response: {
                            200: fullContractSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    const contract = await req.repos.contracts.findByAddress(req.params.contractAddress, {
                        organizationId: req.params.id
                    });
                    return reply.send(contract);
                }
            );

            server.put(
                '/:id/contracts/:contractAddress',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_UPDATE },
                    schema: {
                        description: "Replace one of the organization's contracts (full update)",
                        tags: ['organizations', 'contracts'],
                        params: orgContractParamsSchema,
                        body: updateOrgContractSchema,
                        response: {
                            200: fullContractSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema,
                            409: ErrorResponseSchema,
                            503: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    if (isSystemContractAddress(req.params.contractAddress)) {
                        throw new InvalidInputError('Cannot modify a system contract');
                    }
                    if (isSystemContractAddress(req.body.contractAddress)) {
                        throw new InvalidInputError('Cannot use a system contract address');
                    }
                    // 404s unless the contract belongs to this org.
                    const existing = await req.repos.contracts.findByAddress(req.params.contractAddress, {
                        organizationId: req.params.id
                    });
                    // Deliberately refuses every edit while the linked template carries an umbrella
                    // row, not just template changes; the org admin must drop the template first.
                    await assertTemplateHasNoUmbrella(req, req.body);
                    // A rewrite moves the permissions onto the new address, so it has to clear the
                    // same bar as a fresh registration.
                    const isRewrite = !areHexEqual(existing.contractAddress, req.body.contractAddress);
                    if (isRewrite) {
                        await assertOrgContractRegisterable(req.body.contractAddress, {
                            chainRpc,
                            repos: req.repos,
                            organizationId: req.params.id,
                            caller: req.auth.currentUser()
                        });
                    }
                    // Permission rows follow the address via the FK cascade. Clear umbrella before
                    // the move; a failed update leaves the flag cleared, which is the safe direction.
                    if (isRewrite) {
                        await req.repos.contractFunctionPermissions.clearUmbrella(existing.contractAddress);
                    }
                    // An edit in place keeps the operator-set disclosure flags. A rewrite gets fresh
                    // defaults, so an operator's approval cannot be moved to an address they never saw.
                    const disclosure = isRewrite
                        ? ORG_CONTRACT_DISCLOSURE_DEFAULTS
                        : {
                              discloseBytecode: existing.discloseBytecode,
                              discloseErc20TotalSupply: existing.discloseErc20TotalSupply,
                              disclosedAddresses: existing.disclosedAddresses,
                              disclosureStartBlock: existing.disclosureStartBlock
                          };
                    const contract = await req.repos.contracts.update(req.params.contractAddress, {
                        ...req.body,
                        ...disclosure
                    });

                    if (contract.contractAddress.toLowerCase() !== req.params.contractAddress.toLowerCase()) {
                        try {
                            await req.auditContext.logSecurityEvent(
                                AUDIT_ACTIONS.CONTRACT_ADDRESS_CHANGE,
                                'contract',
                                contract.contractAddress,
                                { previousAddress: req.params.contractAddress, newAddress: contract.contractAddress }
                            );
                        } catch (err) {
                            req.log.error({ err }, 'Failed to emit contract address-change audit event');
                        }
                    }

                    return reply.send(contract);
                }
            );

            server.delete(
                '/:id/contracts/:contractAddress',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_DELETE },
                    schema: {
                        description: "Delete one of the organization's contracts",
                        tags: ['organizations', 'contracts'],
                        params: orgContractParamsSchema,
                        response: {
                            204: z.void(),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await req.repos.organizations.getById(req.params.id);
                    if (isSystemContractAddress(req.params.contractAddress)) {
                        throw new InvalidInputError('Cannot delete a system contract');
                    }
                    // 404s unless the contract belongs to this org.
                    await req.repos.contracts.findByAddress(req.params.contractAddress, {
                        organizationId: req.params.id
                    });
                    await req.repos.contracts.delete(req.params.contractAddress);
                    return reply.status(204).send();
                }
            );

            server.get(
                '/:id/contracts/:contractAddress/function-permissions',
                {
                    schema: {
                        description: "List the function-level role permissions on one of the organization's contracts",
                        tags: ['organizations', 'contract-permissions'],
                        params: orgContractParamsSchema,
                        querystring: orgContractPermissionsListQuerySchema,
                        response: {
                            200: paginatedResult(fullContractPermissionSchema),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsContract(req, req.params.id, req.params.contractAddress);
                    const result = await req.repos.contractFunctionPermissions.findPaginated(
                        { contractAddress: req.params.contractAddress },
                        req.query
                    );
                    return reply.send(result);
                }
            );

            server.post(
                '/:id/contracts/:contractAddress/function-permissions',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_FUNCTION_PERMISSION_CREATE },
                    schema: {
                        description: "Create a function-level role permission on one of the organization's contracts",
                        tags: ['organizations', 'contract-permissions'],
                        params: orgContractParamsSchema,
                        body: createOrgFunctionPermissionSchema,
                        response: {
                            201: fullContractPermissionSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsContract(req, req.params.id, req.params.contractAddress);
                    await assertRolesBelongToOrg(req, req.params.id, req.body.roles);
                    const permission = await req.repos.contractFunctionPermissions.create({
                        ...req.body,
                        contractAddress: req.params.contractAddress,
                        organizationOnly: true,
                        isUmbrella: false
                    });
                    return reply.status(201).send(permission);
                }
            );

            server.put(
                '/:id/contracts/:contractAddress/function-permissions/:permissionId',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_FUNCTION_PERMISSION_UPDATE },
                    schema: {
                        description: "Replace a function-level role permission on one of the organization's contracts",
                        tags: ['organizations', 'contract-permissions'],
                        params: orgFunctionPermissionParamsSchema,
                        body: updateOrgFunctionPermissionSchema,
                        response: {
                            200: fullContractPermissionSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsContract(req, req.params.id, req.params.contractAddress);
                    const existing = await req.repos.contractFunctionPermissions.getPermissionById(
                        req.params.permissionId
                    );
                    assertPermissionOnContract(existing, req.params.contractAddress, 'Contract permission');
                    await assertRolesBelongToOrg(req, req.params.id, req.body.roles);
                    const updated = await req.repos.contractFunctionPermissions.update(req.params.permissionId, {
                        ...req.body,
                        contractAddress: req.params.contractAddress,
                        organizationOnly: true,
                        // From the row, never the body: an org admin cannot set the flag, and an
                        // edit must not silently strip one a zone operator set.
                        isUmbrella: existing.isUmbrella
                    });
                    return reply.send(updated);
                }
            );

            server.delete(
                '/:id/contracts/:contractAddress/function-permissions/:permissionId',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_FUNCTION_PERMISSION_DELETE },
                    schema: {
                        description: "Delete a function-level role permission on one of the organization's contracts",
                        tags: ['organizations', 'contract-permissions'],
                        params: orgFunctionPermissionParamsSchema,
                        response: {
                            204: z.void(),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsContract(req, req.params.id, req.params.contractAddress);
                    const existing = await req.repos.contractFunctionPermissions.getPermissionById(
                        req.params.permissionId
                    );
                    assertPermissionOnContract(existing, req.params.contractAddress, 'Contract permission');
                    await req.repos.contractFunctionPermissions.delete(req.params.permissionId);
                    return reply.status(204).send();
                }
            );

            server.get(
                '/:id/contracts/:contractAddress/event-permissions',
                {
                    schema: {
                        description: "List the event-level role permissions on one of the organization's contracts",
                        tags: ['organizations', 'event-permissions'],
                        params: orgContractParamsSchema,
                        querystring: orgContractPermissionsListQuerySchema,
                        response: {
                            200: PaginatedEventPermissionsSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsContract(req, req.params.id, req.params.contractAddress);
                    const result = await req.repos.contractEventsPermissions.findPaginated({
                        ...req.query,
                        contractAddress: req.params.contractAddress
                    });
                    return reply.send(result);
                }
            );

            server.post(
                '/:id/contracts/:contractAddress/event-permissions',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_EVENT_PERMISSION_CREATE },
                    schema: {
                        description: "Create an event-level role permission on one of the organization's contracts",
                        tags: ['organizations', 'event-permissions'],
                        params: orgContractParamsSchema,
                        body: createOrgEventPermissionSchema,
                        response: {
                            201: EventPermissionSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsContract(req, req.params.id, req.params.contractAddress);
                    await assertRolesBelongToOrg(req, req.params.id, req.body.roles);
                    const created = await req.repos.contractEventsPermissions.create({
                        ...req.body,
                        contractAddress: req.params.contractAddress,
                        organizationOnly: true
                    });
                    return reply.status(201).send(created);
                }
            );

            server.put(
                '/:id/contracts/:contractAddress/event-permissions/:eventPermissionId',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_EVENT_PERMISSION_UPDATE },
                    schema: {
                        description: "Replace an event-level role permission on one of the organization's contracts",
                        tags: ['organizations', 'event-permissions'],
                        params: orgEventPermissionParamsSchema,
                        body: updateOrgEventPermissionSchema,
                        response: {
                            200: EventPermissionSchema,
                            400: ErrorResponseSchema,
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsContract(req, req.params.id, req.params.contractAddress);
                    const existing = await req.repos.contractEventsPermissions.getById(req.params.eventPermissionId);
                    assertPermissionOnContract(existing, req.params.contractAddress, 'Event permission');
                    await assertRolesBelongToOrg(req, req.params.id, req.body.roles);
                    const updated = await req.repos.contractEventsPermissions.updateById(req.params.eventPermissionId, {
                        ...req.body,
                        contractAddress: req.params.contractAddress,
                        organizationOnly: true
                    });
                    return reply.send(updated);
                }
            );

            server.delete(
                '/:id/contracts/:contractAddress/event-permissions/:eventPermissionId',
                {
                    config: { audit_action: AUDIT_ACTIONS.CONTRACT_EVENT_PERMISSION_DELETE },
                    schema: {
                        description: "Delete an event-level role permission on one of the organization's contracts",
                        tags: ['organizations', 'event-permissions'],
                        params: orgEventPermissionParamsSchema,
                        response: {
                            204: z.void(),
                            401: ErrorResponseSchema,
                            403: ErrorResponseSchema,
                            404: ErrorResponseSchema
                        }
                    }
                },
                async (req, reply) => {
                    await assertOrgOwnsContract(req, req.params.id, req.params.contractAddress);
                    const existing = await req.repos.contractEventsPermissions.getById(req.params.eventPermissionId);
                    assertPermissionOnContract(existing, req.params.contractAddress, 'Event permission');
                    await req.repos.contractEventsPermissions.deleteById(req.params.eventPermissionId);
                    return reply.status(204).send();
                }
            );
        });
    }
}

async function assertOrgOwnsM2mApp(req: FastifyRequest, organizationId: string, appId: string): Promise<void> {
    await req.repos.organizations.getById(organizationId);
    await req.repos.m2mApps.assertOwnedByOrg(organizationId, appId);
}

function omitKeyHash<T extends { keyHash: string }>(obj: T): Omit<T, 'keyHash'> {
    const { keyHash: _, ...rest } = obj;
    return rest;
}

async function assertOrgOwnsRole(req: FastifyRequest, organizationId: string, roleId: string): Promise<void> {
    await req.repos.organizations.getById(organizationId);
    const role = await req.repos.roles.findScoped(roleId, { organizationId });
    if (role === undefined) {
        throw new EntityNotFound('Role', { id: roleId });
    }
}

async function assertOrgOwnsContract(req: FastifyRequest, organizationId: string, contractAddress: Hex): Promise<void> {
    await req.repos.organizations.getById(organizationId);
    await req.repos.contracts.findByAddress(contractAddress, { organizationId });
}

// A permission on a different contract reads as not-found, so it never leaks across orgs.
function assertPermissionOnContract(
    permission: { id: number | string; contractAddress: string },
    contractAddress: string,
    entityName: string
): void {
    if (permission.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) {
        throw new EntityNotFound(entityName, { id: permission.id });
    }
}

// Templates are zone-global and a contract inherits their permissions, so a zone template carrying an
// umbrella row would hand an org admin the umbrella toggle they cannot set directly.
async function assertTemplateHasNoUmbrella(
    req: FastifyRequest,
    body: { templateId?: number | null; templateKey?: string | null }
): Promise<void> {
    const templateId = await req.repos.contracts.resolveTemplateId(body.templateId, body.templateKey);
    if (templateId === null) return;
    if (await req.repos.templatePermissions.hasUmbrellaPermission(templateId)) {
        throw new InvalidInputError(
            `Template id=${templateId} defines an umbrella permission and cannot be used by an organization contract`
        );
    }
}

async function assertRolesBelongToOrg(
    req: FastifyRequest,
    organizationId: string,
    roles: readonly { id: string }[] | undefined
): Promise<void> {
    await Promise.all(
        (roles ?? []).map(async ({ id }) => {
            if ((await req.repos.roles.findScoped(id, { organizationId })) === undefined) {
                throw new InvalidInputError(`Role "${id}" is not available in this organization`);
            }
        })
    );
}
