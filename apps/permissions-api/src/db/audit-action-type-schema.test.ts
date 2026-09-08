import { AUDIT_ACTIONS } from '@repo/access-control/src/audit-actions';
import { describe, expect, it } from 'vitest';
import { auditActionTypeSchema } from './schema';

// The column was a closed enum until a feature needed to contribute its own
// actions. That enum is what used to guarantee every core action was queryable.
describe('auditActionTypeSchema', () => {
    it.each(Object.values(AUDIT_ACTIONS))('accepts the core action %s', (action) => {
        expect(auditActionTypeSchema.safeParse(action).success).toBe(true);
    });

    it.each(['', 'bare', '.leading', 'trailing.', 'UPPER.case', 'has space.x'])('rejects %j', (value) => {
        expect(auditActionTypeSchema.safeParse(value).success).toBe(false);
    });
});
