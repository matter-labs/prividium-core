import type { PoolClient } from 'pg';

/** Order is the parameter order of {@link setAuditSessionVarsSql}. */
export const AUDIT_SESSION_VARS = [
    { name: 'app.trace_id', nullable: false },
    { name: 'app.request_id', nullable: false },
    { name: 'app.actor_id', nullable: true },
    { name: 'app.actor_type', nullable: false },
    { name: 'app.auth_subject', nullable: true },
    { name: 'app.service_name', nullable: false },
    { name: 'app.operation', nullable: false }
] as const;

/**
 * `is_local=false`: the values persist on the connection, not the transaction, so
 * every later query on that client sees them.
 */
export function setAuditSessionVarsSql(): string {
    return AUDIT_SESSION_VARS.map(({ name, nullable }, index) => {
        const param = `$${index + 1}`;
        return `set_config('${name}', ${nullable ? `COALESCE(${param}, '')` : param}, false)`;
    }).join(', ');
}

/** Built once, so nothing at the call site can interpolate into the statement. */
const CLEAR_AUDIT_SESSION_VARS_SQL = `SELECT ${AUDIT_SESSION_VARS.map(({ name }) => `set_config('${name}', '', false)`).join(', ')}`;

/** Blanks every audit session var, so a pooled client carries no context to its next borrower. */
export async function clearAuditSessionVars(client: PoolClient): Promise<void> {
    await client.query(CLEAR_AUDIT_SESSION_VARS_SQL);
}
