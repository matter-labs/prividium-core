import { z } from 'zod/v4';

export const FeaturePermissionSchema = z.object({
    name: z.string(),
    // The owning feature, as `GET /info` lists it in `features` while enabled.
    feature: z.string(),
    orgGrantable: z.boolean(),
    // A role may still hold it while false, but it grants nothing.
    enabled: z.boolean()
});

export const FeaturePermissionsListSchema = z.object({
    items: z.array(FeaturePermissionSchema)
});

export type FeaturePermissionListing = z.infer<typeof FeaturePermissionSchema>;
