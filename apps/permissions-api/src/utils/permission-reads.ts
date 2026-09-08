import { and, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import type {
    argumentRestrictionsTable,
    contractFunctionPermissionRolesTable,
    contractTemplateArgumentRestrictionsTable,
    contractTemplatePermissionRolesTable
} from '../db/schema';
import { fetchChunked } from './fetch-chunked';

/**
 * Permission ids in `permissionIds` with at least one role row matching one of
 * `roleIds`. An empty id or role set short-circuits to no match, mirroring a
 * role check with an empty `inArray`. Reads are chunked under the Postgres
 * bound-parameter limit. Works against either the contract or template role
 * table.
 */
export async function fetchRoleSet(
    db: DbOrTx,
    table: typeof contractFunctionPermissionRolesTable | typeof contractTemplatePermissionRolesTable,
    permissionIds: number[],
    roleIds: string[]
): Promise<Set<number>> {
    if (permissionIds.length === 0 || roleIds.length === 0) return new Set();
    const rows = await fetchChunked(permissionIds, (chunk) =>
        db
            .select({ permissionId: table.permissionId })
            .from(table)
            .where(and(inArray(table.permissionId, chunk), inArray(table.roleId, roleIds)))
    );
    return new Set(rows.map((r) => r.permissionId).filter((id): id is number => id !== null));
}

/**
 * Maps each permission id in `permissionIds` to its restricted argument indices.
 * Permission ids with no restrictions are absent from the map. Reads are chunked
 * under the Postgres bound-parameter limit. Works against either the contract or
 * template argument-restriction table.
 */
export async function fetchArgMap(
    db: DbOrTx,
    table: typeof argumentRestrictionsTable | typeof contractTemplateArgumentRestrictionsTable,
    permissionIds: number[]
): Promise<Map<number, { argumentIndex: number }[]>> {
    const map = new Map<number, { argumentIndex: number }[]>();
    if (permissionIds.length === 0) return map;
    const rows = await fetchChunked(permissionIds, (chunk) =>
        db
            .select({ permissionId: table.permissionId, argumentIndex: table.argumentIndex })
            .from(table)
            .where(inArray(table.permissionId, chunk))
    );
    for (const r of rows) {
        if (r.permissionId === null) continue;
        const arr = map.get(r.permissionId) ?? [];
        arr.push({ argumentIndex: r.argumentIndex });
        map.set(r.permissionId, arr);
    }
    return map;
}
