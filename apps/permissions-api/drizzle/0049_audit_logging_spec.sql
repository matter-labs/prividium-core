-- Audit logging: application audit log columns, mutation evidence layer, and request correlation.

-- Part 1: new correlation columns on audit_logs
ALTER TABLE "audit_logs" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_type" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "auth_subject" text;--> statement-breakpoint

-- Part 2: audit_request_log — one row per audited HTTP request.
-- Written by createAuditContextMiddleware before the handler runs.
-- Join to db_mutation_audit_logs on request_id to correlate DB mutations
-- with the business operation that caused them.
CREATE TABLE IF NOT EXISTS "audit_request_log" (
    "id"           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "request_id"   text        NOT NULL UNIQUE,
    "trace_id"     text        NOT NULL,
    "operation"    text        NOT NULL,
    "actor_id"     text,
    "actor_type"   text        NOT NULL,
    "auth_subject" text,
    "service_name" text        NOT NULL,
    "method"       text        NOT NULL,
    "url"          text        NOT NULL,
    "ip"           text,
    "user_agent"   text,
    "created_at"   timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "idx_audit_request_log_trace_id"   ON "audit_request_log" ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_audit_request_log_operation"  ON "audit_request_log" ("operation");--> statement-breakpoint
CREATE INDEX "idx_audit_request_log_actor_id"   ON "audit_request_log" ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_audit_request_log_created_at" ON "audit_request_log" ("created_at");--> statement-breakpoint

-- Part 3: db_mutation_audit_logs — Postgres mutation evidence layer.
-- Rows are written exclusively by triggers; the application never INSERTs here directly.
-- Full actor/trace context is in audit_request_log; join on request_id.
CREATE TABLE IF NOT EXISTS "db_mutation_audit_logs" (
    "id"              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "occurred_at"     timestamptz NOT NULL DEFAULT now(),
    "txid"            bigint      NOT NULL,
    "schema_name"     text        NOT NULL,
    "table_name"      text        NOT NULL,
    "operation"       text        NOT NULL CHECK ("operation" IN ('INSERT', 'UPDATE', 'DELETE')),
    "primary_key"     text,
    "old_row"         jsonb,
    "new_row"         jsonb,
    "changed_columns" text[],
    -- Correlation keys only; all other context lives in audit_request_log
    "request_id"      text,
    "job_id"          text,
    CONSTRAINT "fk_mutation_request_log"
        FOREIGN KEY ("request_id") REFERENCES "audit_request_log" ("request_id")
        ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED
);--> statement-breakpoint

-- Part 4: Postgres function that triggers call to capture mutation evidence.
-- Reads correlation keys from session variables set by createAuditContextMiddleware.
--
-- Trigger arguments (in CREATE TRIGGER ... EXECUTE FUNCTION):
--   pk:<col>[,<col2>...]  — PK column names; comma-separated for composite PKs.
--                           Resolved before redaction so sensitive-column PKs
--                           (e.g. passkey_challenges.challenge) are still captured
--                           even if the column is later stripped from the row snapshot.
--                           Single-column PKs → bare value.
--                           Composite PKs     → JSON object {"col1":"val1",...}.
--   <col>                 — Column name to strip from row snapshots (redaction).
--
-- Examples:
--   EXECUTE FUNCTION capture_db_mutation_audit('pk:id')
--   EXECUTE FUNCTION capture_db_mutation_audit('pk:id', 'secret_col')
--   EXECUTE FUNCTION capture_db_mutation_audit('pk:user_id,role_name')
--   EXECUTE FUNCTION capture_db_mutation_audit('pk:challenge', 'challenge')
--
-- SECURITY DEFINER: the function runs with the privileges of its owner (typically
-- the migration role) rather than the invoking app role.  This means the app DB
-- user does NOT need INSERT on db_mutation_audit_logs, which prevents the
-- application from tampering with the audit trail directly.
CREATE OR REPLACE FUNCTION capture_db_mutation_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_row         jsonb;
    v_new_row         jsonb;
    v_changed_columns text[];
    v_primary_key     text;
    v_pk_columns      text[];
    v_redact_columns  text[];
    v_row             jsonb;
    v_pk_json         jsonb;
    v_col             text;
    v_arg             text;
BEGIN
    -- Parse trigger arguments: pk:<cols> → PK columns; bare names → redaction columns.
    IF TG_NARGS > 0 THEN
        FOREACH v_arg IN ARRAY TG_ARGV LOOP
            IF v_arg LIKE 'pk:%' THEN
                v_pk_columns := string_to_array(substring(v_arg FROM 4), ',');
            ELSE
                v_redact_columns := array_append(v_redact_columns, v_arg);
            END IF;
        END LOOP;
    END IF;

    -- Capture row images.
    IF TG_OP = 'DELETE' THEN
        v_old_row := to_jsonb(OLD);
        v_new_row := NULL;
    ELSIF TG_OP = 'INSERT' THEN
        v_old_row := NULL;
        v_new_row := to_jsonb(NEW);
    ELSE -- UPDATE
        v_old_row := to_jsonb(OLD);
        v_new_row := to_jsonb(NEW);
    END IF;

    -- Resolve primary key before redaction so sensitive-column PKs are still captured.
    IF v_pk_columns IS NOT NULL THEN
        v_row := COALESCE(v_new_row, v_old_row);
        IF array_length(v_pk_columns, 1) = 1 THEN
            v_primary_key := v_row ->> v_pk_columns[1];
        ELSE
            v_pk_json := '{}'::jsonb;
            FOREACH v_col IN ARRAY v_pk_columns LOOP
                v_pk_json := v_pk_json || jsonb_build_object(v_col, v_row ->> v_col);
            END LOOP;
            v_primary_key := v_pk_json::text;
        END IF;
    END IF;

    -- Strip redaction columns from row snapshots before persisting.
    IF v_redact_columns IS NOT NULL THEN
        v_old_row := v_old_row - v_redact_columns;
        v_new_row := v_new_row - v_redact_columns;
    END IF;

    -- Compute changed columns after redaction so sensitive column names are not
    -- leaked in the diff list even when their values are stripped from the snapshots.
    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(key ORDER BY key)
        INTO v_changed_columns
        FROM jsonb_each(v_old_row) AS old_col(key, value)
        WHERE old_col.value IS DISTINCT FROM (v_new_row -> old_col.key)
           OR NOT (v_new_row ? old_col.key);
    END IF;

    INSERT INTO db_mutation_audit_logs (
        txid,
        schema_name,
        table_name,
        operation,
        primary_key,
        old_row,
        new_row,
        changed_columns,
        -- Only correlation keys; all other context lives in audit_request_log
        request_id,
        job_id
    ) VALUES (
        txid_current(),
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        TG_OP,
        v_primary_key,
        v_old_row,
        v_new_row,
        v_changed_columns,
        NULLIF(current_setting('app.request_id', true), ''),
        NULLIF(current_setting('app.job_id',     true), '')
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

-- Part 5: Attach the trigger to each audited table.
-- AFTER triggers ensure the row image is final before we capture it.
-- First arg is always pk:<columns>; subsequent args are columns to redact.

CREATE TRIGGER audit_users
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id', 'wallet_token');--> statement-breakpoint

CREATE TRIGGER audit_roles
    AFTER INSERT OR UPDATE OR DELETE ON roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:role_name');--> statement-breakpoint

CREATE TRIGGER audit_tenants
    AFTER INSERT OR UPDATE OR DELETE ON tenants
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_contracts
    AFTER INSERT OR UPDATE OR DELETE ON contracts
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:contract_address');--> statement-breakpoint

CREATE TRIGGER audit_contract_function_permissions
    AFTER INSERT OR UPDATE OR DELETE ON contract_function_permissions
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_contract_event_permissions
    AFTER INSERT OR UPDATE OR DELETE ON contract_event_permissions
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_contract_templates
    AFTER INSERT OR UPDATE OR DELETE ON contract_templates
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_services
    AFTER INSERT OR UPDATE OR DELETE ON services
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_passkey_credentials
    AFTER INSERT OR UPDATE OR DELETE ON passkey_credentials
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id', 'public_key');--> statement-breakpoint

-- audit_sessions intentionally omitted: sessions are written on every authenticated
-- request, making per-row trigger overhead unacceptable on high-frequency paths.--> statement-breakpoint

CREATE TRIGGER audit_user_roles
    AFTER INSERT OR UPDATE OR DELETE ON user_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:user_id,role_name');--> statement-breakpoint

CREATE TRIGGER audit_user_wallets
    AFTER INSERT OR UPDATE OR DELETE ON user_wallets
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_wallet_transaction_allowances
    AFTER INSERT OR UPDATE OR DELETE ON wallet_transaction_allowances
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:user_id,wallet_address,transaction_nonce');--> statement-breakpoint

CREATE TRIGGER audit_contract_function_permission_roles
    AFTER INSERT OR UPDATE OR DELETE ON contract_function_permission_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_contract_event_permissions_roles
    AFTER INSERT OR UPDATE OR DELETE ON contract_event_permissions_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_function_argument_restrictions
    AFTER INSERT OR UPDATE OR DELETE ON function_argument_restrictions
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_contract_template_permissions
    AFTER INSERT OR UPDATE OR DELETE ON contract_template_permissions
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_contract_template_permission_roles
    AFTER INSERT OR UPDATE OR DELETE ON contract_template_permission_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_contract_template_argument_restrictions
    AFTER INSERT OR UPDATE OR DELETE ON contract_template_argument_restrictions
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_contract_deployments
    AFTER INSERT OR UPDATE OR DELETE ON contract_deployments
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_bytecode_disclosure_permissions
    AFTER INSERT OR UPDATE OR DELETE ON bytecode_disclosure_permissions
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:address');--> statement-breakpoint

CREATE TRIGGER audit_bytecode_disclosure_permission_roles
    AFTER INSERT OR UPDATE OR DELETE ON bytecode_disclosure_permission_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:address,role_name');--> statement-breakpoint

CREATE TRIGGER audit_balance_disclosure_lock_addresses
    AFTER INSERT OR UPDATE OR DELETE ON balance_disclosure_lock_addresses
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:contract_address,lock_address');--> statement-breakpoint

CREATE TRIGGER audit_applications
    AFTER INSERT OR UPDATE OR DELETE ON applications
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

CREATE TRIGGER audit_tenants_default_roles
    AFTER INSERT OR UPDATE OR DELETE ON tenants_default_roles
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:tenant_id,role_name');--> statement-breakpoint

CREATE TRIGGER audit_tenants_users
    AFTER INSERT OR UPDATE OR DELETE ON tenants_users
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:tenant_id,user_id');--> statement-breakpoint

CREATE TRIGGER audit_tenant_api_keys
    AFTER INSERT OR UPDATE OR DELETE ON tenant_api_keys
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id', 'key_hash');--> statement-breakpoint

CREATE TRIGGER audit_tenant_ip_whitelist
    AFTER INSERT OR UPDATE OR DELETE ON tenant_ip_whitelist
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id');--> statement-breakpoint

-- challenge is both the PK and a sensitive column; pk: captures it before redaction strips it.
CREATE TRIGGER audit_passkey_challenges
    AFTER INSERT OR UPDATE OR DELETE ON passkey_challenges
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:challenge', 'challenge');--> statement-breakpoint

-- audit_siwe_challenge_log intentionally omitted: one row written per wallet auth
-- challenge initiation; trigger overhead is not justified here.--> statement-breakpoint

-- audit_siwe_consumed_nonces intentionally omitted: nonces are consumed at high
-- frequency during wallet auth flows; trigger overhead is not justified here.--> statement-breakpoint

-- Part 6: Performance indexes on db_mutation_audit_logs for forensic queries
CREATE INDEX "idx_db_mutation_audit_logs_request_id" ON "db_mutation_audit_logs" ("request_id");--> statement-breakpoint
CREATE INDEX "idx_db_mutation_audit_table"            ON "db_mutation_audit_logs" ("table_name", "occurred_at");--> statement-breakpoint
CREATE INDEX "idx_db_mutation_audit_txid"             ON "db_mutation_audit_logs" ("txid");--> statement-breakpoint
