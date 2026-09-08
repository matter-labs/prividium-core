-- Add full_read_access system permission to admin role
UPDATE "roles"
SET "system_permissions" = array_append("system_permissions", 'full_read_access')
WHERE "role_name" = 'admin'
AND NOT ('full_read_access' = ANY("system_permissions"));
