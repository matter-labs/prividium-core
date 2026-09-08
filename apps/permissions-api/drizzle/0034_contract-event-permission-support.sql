ALTER TABLE "contract_permissions"
    RENAME TO "contract_function_permissions"; --> statement-breakpoint
ALTER TABLE "contract_function_permissions"
    RENAME CONSTRAINT contract_permissions_contract_address_contracts_contract_addres TO contract_function_permission_address_contracts_address;
ALTER TABLE "contract_function_permissions"
    RENAME CONSTRAINT contract_permissions_pkey TO contract_function_permissions_pkey;
ALTER TABLE "contract_function_permissions"
    RENAME CONSTRAINT contract_permissions_unique_attributes TO contract_function_permissions_unique_attributes;


ALTER TABLE "contract_permission_roles"
    RENAME TO "contract_function_permission_roles"; --> statement-breakpoint
ALTER TABLE "contract_function_permission_roles"
    RENAME CONSTRAINT contract_permission_roles_permission_id_contract_permissions_id TO contract_function_permission_roles_permission_id;
ALTER TABLE "contract_function_permission_roles"
    RENAME CONSTRAINT contract_permission_roles_role_name_roles_role_name_fk TO contract_function_permission_roles_role_name;
ALTER TABLE "contract_function_permission_roles"
    RENAME CONSTRAINT contract_permission_roles_pkey TO contract_function_permission_roles_pkey;
ALTER TABLE "contract_function_permission_roles"
    RENAME CONSTRAINT contract_permission_roles_unique_role TO contract_function_permission_roles_unique_role;

--> statement-breakpoint
CREATE TABLE "contract_event_permissions_roles"
(
    "id"                  integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contract_event_permissions_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
    "event_permission_id" text                                   NOT NULL,
    "role_name"           text                                   NOT NULL,
    "created_at"          timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"          timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_event_permissions"
(
    "id"                    text PRIMARY KEY                       NOT NULL,
    "contract_address"      "bytea"                                NOT NULL,
    "topic0_constant"       "bytea",
    "topic1_constant"       "bytea",
    "topic2_constant"       "bytea",
    "topic3_constant"       "bytea",
    "topic1_condition_type" text,
    "topic2_condition_type" text,
    "topic3_condition_type" text,
    "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"            timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "chk_conditions_" CHECK (
        (("contract_event_permissions"."topic1_constant" IS NULL) OR
         ("contract_event_permissions"."topic1_constant" IS NOT NULL AND
          "contract_event_permissions"."topic1_condition_type" = 'equalTo'))
            AND
        (("contract_event_permissions"."topic2_constant" IS NULL) OR
         ("contract_event_permissions"."topic2_constant" IS NOT NULL AND
          "contract_event_permissions"."topic2_condition_type" = 'equalTo'))
            AND
        (("contract_event_permissions"."topic3_constant" IS NULL) OR
         ("contract_event_permissions"."topic3_constant" IS NOT NULL AND
          "contract_event_permissions"."topic3_condition_type" = 'equalTo'))
        )
);


--> statement-breakpoint
ALTER TABLE "contract_event_permissions_roles"
    ADD CONSTRAINT "contract_event_permissions_roles_event_permission_id_contract_event_permissions_id_fk" FOREIGN KEY ("event_permission_id") REFERENCES "public"."contract_event_permissions" ("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_event_permissions_roles"
    ADD CONSTRAINT "contract_event_permissions_roles_role_name_roles_role_name_fk" FOREIGN KEY ("role_name") REFERENCES "public"."roles" ("role_name") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_event_permissions"
    ADD CONSTRAINT "contract_event_permissions_contract_address_contracts_contract_address_fk" FOREIGN KEY ("contract_address") REFERENCES "public"."contracts" ("contract_address") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "contract_event_permissions_contract_address_topic0_constant_index" ON "contract_event_permissions" USING btree ("contract_address", "topic0_constant");--> statement-breakpoint
ALTER TABLE "function_argument_restrictions"
    ADD CONSTRAINT "function_argument_restrictions_permission_id_contract_function_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."contract_function_permissions" ("id") ON DELETE cascade ON UPDATE cascade;
