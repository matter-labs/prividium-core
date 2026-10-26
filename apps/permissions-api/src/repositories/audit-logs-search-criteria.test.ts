import { describe, expect, it } from 'vitest';
import { AuditLogsSearchCriteriaSchema } from './audit-logs-repository';

describe('AuditLogsSearchCriteriaSchema', () => {
    it('accepts minute-precision date bounds', () => {
        const criteria = { startDate: '2026-01-01T00:00Z', endDate: '2026-01-02T00:00Z' };

        expect(AuditLogsSearchCriteriaSchema.parse(criteria)).toEqual(criteria);
    });
});
