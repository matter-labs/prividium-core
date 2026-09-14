SELECT set_config('app.reserved_org_contracts_previous_lock_timeout', current_setting('lock_timeout'), true);
--> statement-breakpoint
SELECT set_config('lock_timeout', CASE WHEN setting::integer = 0 THEN '3000' ELSE least(setting::integer, 3000)::text END, true)
FROM pg_settings WHERE name = 'lock_timeout';
--> statement-breakpoint
LOCK TABLE "contracts" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
SELECT set_config('app.job_id', 'migration:reject_reserved_org_contracts', true);
--> statement-breakpoint
-- Delete the claim and its cascading grants; clearing organization_id would publish those grants zone-wide.
DELETE FROM "contracts"
WHERE "organization_id" IS NOT NULL
  AND "contract_address" BETWEEN decode('0000000000000000000000000000000000008000', 'hex')
                             AND decode('000000000000000000000000000000000001ffff', 'hex');
--> statement-breakpoint
SELECT set_config('app.job_id', '', true);
--> statement-breakpoint
-- Validate under the existing lock so cleanup and enforcement commit atomically.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "contracts" ADD CONSTRAINT "chk_contracts_no_reserved_org_address" CHECK ("contracts"."organization_id" IS NULL OR "contracts"."contract_address" NOT BETWEEN decode('0000000000000000000000000000000000008000', 'hex') AND decode('000000000000000000000000000000000001ffff', 'hex'));
--> statement-breakpoint
SELECT set_config('lock_timeout', current_setting('app.reserved_org_contracts_previous_lock_timeout'), true);
