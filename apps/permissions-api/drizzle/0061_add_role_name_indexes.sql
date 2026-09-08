-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS "idx_contract_function_permission_roles_role_name" ON "contract_function_permission_roles" USING btree ("role_name");--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS "idx_user_roles_role_name" ON "user_roles" USING btree ("role_name");
