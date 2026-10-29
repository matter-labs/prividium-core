import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DatabaseBeforeMigration, databaseBeforeMigration } from '#test/migration-upgrade';

// Every other migration test in the repo runs 0077 on an empty database. This one exercises the risky
// part — the backfill — by migrating a fresh database only up to 0074, seeding legacy-shaped rows
// (role_name as the primary/foreign key, org-admin roles carrying the forced "Admin(<orgId>)" name),
// then applying the real 0077 SQL and asserting the upgrade an existing environment would actually get.

describe('0077 roles surrogate-id migration — upgrade path with legacy data', () => {
    let db: DatabaseBeforeMigration;

    beforeAll(async () => {
        db = await databaseBeforeMigration('0077_roles_surrogate_id');
    }, 120_000);

    afterAll(async () => {
        await db?.drop();
    });

    it('backfills ids, pins the zone admin id, re-points references, and de-suffixes org-admin names', async () => {
        const { pool } = db;
        // --- seed the pre-0077 shape: role_name is the key, org-admin roles carry the suffixed name ---
        await pool.query(`INSERT INTO organizations (id, name) VALUES ('org-1', 'Org One'), ('org-2', 'Org Two')`);
        await pool.query(`
            INSERT INTO roles (role_name, system_permissions, is_system_role, organization_id) VALUES
                ('admin',         '{}', true,  NULL),
                ('viewer',        '{}', false, NULL),
                ('Admin(org-1)',  '{}', true,  'org-1'),
                ('Admin(org-2)',  '{}', true,  'org-2'),
                ('Admin',         '{}', false, 'org-2')
        `);
        await pool.query(`INSERT INTO users (id, display_name, source) VALUES ('user-1', 'User One', 'oidc')`);
        await pool.query(`INSERT INTO user_roles (user_id, role_name) VALUES ('user-1', 'viewer')`);

        await db.applyTarget();

        // --- assert the upgraded shape ---
        const roles = (
            await pool.query<{ id: string; role_name: string; organization_id: string | null }>(
                'SELECT id, role_name, organization_id FROM roles'
            )
        ).rows;
        const byKey = (name: string, org: string | null) =>
            roles.find((r) => r.role_name === name && r.organization_id === org);

        // Every role got an id; the zone admin role is pinned to the stable "admin".
        expect(roles.every((r) => r.id !== null && r.id.length > 0)).toBe(true);
        expect(byKey('admin', null)?.id).toBe('admin');

        // Non-admin roles get a fresh nanoid-shaped id (21 chars) that differs from the name.
        const viewer = byKey('viewer', null)!;
        expect(viewer.id).toHaveLength(21);
        expect(viewer.id).not.toBe('viewer');

        // References were re-pointed from role_name to the backfilled role_id.
        const userRoleId = (
            await pool.query<{ role_id: string }>("SELECT role_id FROM user_roles WHERE user_id = 'user-1'")
        ).rows[0]?.role_id;
        expect(userRoleId).toBe(viewer.id);

        // org-1's admin role is de-suffixed to "Admin" now that names are unique per organization.
        expect(byKey('Admin(org-1)', 'org-1')).toBeUndefined();
        expect(byKey('Admin', 'org-1')?.id).toBeDefined();

        // org-2 already has a *custom* role named "Admin", so its system role keeps the suffix to avoid
        // a per-org name collision (the migration's guard).
        expect(byKey('Admin(org-2)', 'org-2')?.id).toBeDefined();
        expect(byKey('Admin', 'org-2')?.id).toBeDefined();
    }, 120_000);
});
