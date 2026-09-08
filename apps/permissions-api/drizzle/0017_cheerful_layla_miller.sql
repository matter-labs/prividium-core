-- We should not have any repeated role assigned to the same permission. But this was
-- not enforced. If there is a repeated role we are saving the one with lower id. This is just
-- to be extra careful about a migration not failing.
DELETE
FROM contract_permission_roles
WHERE id NOT IN (SELECT MIN(id)
                 FROM contract_permission_roles
                 GROUP BY permission_id);

ALTER TABLE "contract_permission_roles"
    ADD CONSTRAINT "contract_permission_roles_unique_role" UNIQUE ("permission_id", "role_name");