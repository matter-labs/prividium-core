-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "uq_users_oidc_sub_when_no_issuer" ON "users" USING btree ("oidc_sub") WHERE "users"."oidc_issuer" is null;