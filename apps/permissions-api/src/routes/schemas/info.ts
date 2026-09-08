import { z } from 'zod/v4';

export const InfoSchema = z.object({
    policyEnabled: z.boolean(),
    // Names of the optional features this deployment registered. Opaque to the core.
    features: z.array(z.string()),
    multiOrgEnabled: z.boolean(),
    orgRoutingByDomain: z.boolean(),
    // Org bound to the serving domain (ingress-stamped X-Org-Id request header); null = zone.
    orgId: z.string().nullable()
});
