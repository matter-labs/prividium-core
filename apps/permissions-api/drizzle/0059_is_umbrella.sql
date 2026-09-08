ALTER TABLE "contract_function_permissions" ADD COLUMN "is_umbrella" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_template_permissions" ADD COLUMN "is_umbrella" boolean DEFAULT false NOT NULL;
