ALTER TABLE "tenants" DROP CONSTRAINT "tenants_application_id_applications_id_fk";

DELETE FROM "applications" WHERE "id" IN (SELECT "application_id" FROM "tenants");

--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "application_id";
