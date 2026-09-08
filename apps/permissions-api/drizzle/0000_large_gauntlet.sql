CREATE TABLE IF NOT EXISTS "contract_permission_roles" (
	"contract_address" "bytea" NOT NULL,
	"method_selector" "bytea" NOT NULL,
	"role_name" text NOT NULL,
	"audience" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_permission_roles_contract_address_method_selector_role_name_audience_pk" PRIMARY KEY("contract_address","method_selector","role_name","audience")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_permissions" (
	"contract_address" "bytea" NOT NULL,
	"method_selector" "bytea" NOT NULL,
	"function_signature" text NOT NULL,
	"rule_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_permissions_contract_address_method_selector_pk" PRIMARY KEY("contract_address","method_selector")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contracts" (
	"contract_address" "bytea" PRIMARY KEY NOT NULL,
	"abi" text NOT NULL,
	"name" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"role_name" text NOT NULL,
	"audience" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_role_name_audience_pk" PRIMARY KEY("role_name","audience")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rpc_permission_roles" (
	"rpc_endpoint_name" text NOT NULL,
	"role_name" text NOT NULL,
	"audience" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rpc_permission_roles_rpc_endpoint_name_role_name_audience_pk" PRIMARY KEY("rpc_endpoint_name","role_name","audience")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rpc_permissions" (
	"rpc_endpoint_name" text PRIMARY KEY NOT NULL,
	"rule_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" text NOT NULL,
	"role_name" text NOT NULL,
	"audience" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_name_audience_pk" PRIMARY KEY("user_id","role_name","audience")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_wallets" (
	"user_id" text NOT NULL,
	"wallet_address" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_wallets_user_id_wallet_address_pk" PRIMARY KEY("user_id","wallet_address")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"wallet_address" "bytea" PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_permission_roles" ADD CONSTRAINT "contract_perm_roles_perm_fk" FOREIGN KEY ("contract_address","method_selector") REFERENCES "public"."contract_permissions"("contract_address","method_selector") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_permission_roles" ADD CONSTRAINT "contract_perm_roles_role_fk" FOREIGN KEY ("role_name","audience") REFERENCES "public"."roles"("role_name","audience") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rpc_permission_roles" ADD CONSTRAINT "rpc_perm_roles_perm_fk" FOREIGN KEY ("rpc_endpoint_name") REFERENCES "public"."rpc_permissions"("rpc_endpoint_name") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rpc_permission_roles" ADD CONSTRAINT "rpc_perm_roles_role_fk" FOREIGN KEY ("role_name","audience") REFERENCES "public"."roles"("role_name","audience") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_fk" FOREIGN KEY ("role_name","audience") REFERENCES "public"."roles"("role_name","audience") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_wallet_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallets"("wallet_address") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
