import { readFile } from 'node:fs/promises';
import { expect } from 'vitest';
import { it } from '../../test/unit-test-context';
import { auditAudienceIndexIsValid } from './audit-audience-index';

it('recognizes the rollout index and detects missing or invalid builds', async ({ db }) => {
    expect(await auditAudienceIndexIsValid(db.$client)).toBe(true);

    await db.$client.query('DROP INDEX idx_audit_logs_affected_organization_ids');
    expect(await auditAudienceIndexIsValid(db.$client)).toBe(false);

    const sql = await readFile(new URL('../../scripts/create-audit-audience-index.sql', import.meta.url), 'utf8');
    await db.$client.query(sql);
    await db.$client.query(sql);
    expect(await auditAudienceIndexIsValid(db.$client)).toBe(true);

    await db.$client.query(
        "UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'idx_audit_logs_affected_organization_ids'::regclass"
    );
    expect(await auditAudienceIndexIsValid(db.$client)).toBe(false);
});
