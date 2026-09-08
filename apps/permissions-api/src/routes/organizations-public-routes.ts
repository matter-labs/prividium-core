import { z } from 'zod/v4';
import type { FastifyServer } from '../build-app';
import { EntityNotFound } from '../utils/error-types';
import { ErrorResponseSchema } from '../utils/schemas/fastify-common';

const byIdParamSchema = z.object({ id: z.string() });

const oidcProviderDiscoverySchema = z.object({
    issuer: z.string(),
    clientId: z.string(),
    displayName: z.string().nullable(),
    userPanelUrl: z.string().nullable(),
    // Lets the org login page decide whether to offer wallet login; the allowlist is not disclosed here
    // (challenge creation still accepts/rejects per domain, so entries are unlisted rather than secret).
    siweLoginEnabled: z.boolean(),
    branding: z.object({
        brandName: z.string().nullable(),
        logoUrl: z.string().nullable(),
        primaryColor: z.string().nullable()
    })
});

type Deps = {
    multiOrgEnabled: boolean;
};

export function organizationsPublicRoutes(server: FastifyServer, { multiOrgEnabled }: Deps) {
    server.get(
        '/:id/oidc-provider',
        {
            schema: {
                description:
                    "Public OIDC discovery for an organization: issuer, client ID and branding, so admin/user panels can route to the organization's identity provider before authenticating. Excludes the JWKS URI.",
                tags: ['organizations', 'oidc'],
                params: byIdParamSchema,
                response: {
                    200: oidcProviderDiscoverySchema,
                    404: ErrorResponseSchema
                }
            }
        },
        async (req, reply) => {
            if (!multiOrgEnabled) {
                throw new EntityNotFound('Organization', { id: req.params.id });
            }

            const provider = await req.repos.oidcProviders.findById(req.params.id);
            if (!provider) {
                throw new EntityNotFound('OidcProvider', { organizationId: req.params.id });
            }

            const organization = await req.repos.organizations.getById(req.params.id);

            return reply.send({
                issuer: provider.issuer,
                clientId: provider.clientId,
                displayName: provider.displayName,
                userPanelUrl: provider.userPanelUrl,
                siweLoginEnabled: organization.siweLoginEnabled,
                branding: {
                    brandName: organization.brandName,
                    logoUrl: organization.logoUrl,
                    primaryColor: organization.primaryColor
                }
            });
        }
    );
}
