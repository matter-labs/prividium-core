import { z } from 'zod/v4';
import { RULES_FINGERPRINT, rulesSchema } from '../../services/event-permission-verifier';

export const EventPermissionRulesResponseSchema = z.object({
    fingerprint: z.literal(RULES_FINGERPRINT),
    rules: rulesSchema
});
