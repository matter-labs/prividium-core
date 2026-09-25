import type { Pool } from 'pg';

export async function auditAudienceIndexIsValid(pool: Pool): Promise<boolean> {
    const result = await pool.query<{ indisvalid: boolean }>(
        "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('public.idx_audit_logs_affected_organization_ids')"
    );
    return result.rows[0]?.indisvalid === true;
}
