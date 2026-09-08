-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS "idx_users_organization_id_created_at_id" ON "users" USING btree ("organization_id" NULLS FIRST,"created_at","id");