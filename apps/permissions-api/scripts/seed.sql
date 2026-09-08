-- Baseline roles for a fresh database.
--
-- `admin` must exist before anyone can sign in: a wallet listed in CRYPTO_NATIVE_ADMIN_WALLETS (or a
-- sub in OIDC_ADMIN_SUBS) is auto-provisioned with this role, and user_roles.role_id has a foreign
-- key to roles.id. Migrations only ever update this row, never create it.
--
-- `user` grants nothing. It exists so an administrator has a role to assign, and so the
-- deny-by-default path is exercisable without writing one first.

INSERT INTO roles (id, role_name, system_permissions, is_system_role)
VALUES
    ('admin', 'admin', '{contract_deployment,full_sequencer_rpc_access,full_read_access,admin_read,admin_write}', true),
    ('role-user', 'user', '{}', false)
ON CONFLICT (organization_id, role_name) DO NOTHING;
