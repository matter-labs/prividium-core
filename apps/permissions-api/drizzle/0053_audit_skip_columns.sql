-- Extend capture_db_mutation_audit with skip:<cols> support.
--
-- New trigger argument prefix:
--   skip:<col>[,<col2>...]  — Columns excluded from the UPDATE diff.
--                             If an UPDATE changes ONLY columns in this list,
--                             no audit row is written (RETURN NEW with no INSERT).
--                             These columns still appear in old_row/new_row snapshots;
--                             only the changed-columns diff and the "should we audit this?" decision are affected.
--
-- Use case: high-frequency metadata columns (e.g. last_used_at, last_used_ip on api_keys)
-- that are written on every API call but carry no meaningful audit signal on their own.

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
    v_skip_columns    text[];
    v_row             jsonb;
    v_pk_json         jsonb;
    v_col             text;
    v_arg             text;
BEGIN
    -- Parse trigger arguments:
    --   pk:<cols>   → PK column names (comma-separated)
    --   skip:<cols> → columns excluded from UPDATE diff; UPDATE touching only these is not audited
    --   <col>       → column to strip from row snapshots (redaction)
    IF TG_NARGS > 0 THEN
        FOREACH v_arg IN ARRAY TG_ARGV LOOP
            IF v_arg LIKE 'pk:%' THEN
                v_pk_columns := string_to_array(substring(v_arg FROM 4), ',');
            ELSIF v_arg LIKE 'skip:%' THEN
                v_skip_columns := string_to_array(substring(v_arg FROM 6), ',');
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
    -- Skip columns are excluded from the diff: if only skip columns changed, no audit row is written.
    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(key ORDER BY key)
        INTO v_changed_columns
        FROM jsonb_each(v_old_row) AS old_col(key, value)
        WHERE (old_col.value IS DISTINCT FROM (v_new_row -> old_col.key)
           OR NOT (v_new_row ? old_col.key))
          AND (v_skip_columns IS NULL OR NOT (old_col.key = ANY(v_skip_columns)));

        -- Only skip-listed columns changed → no meaningful mutation, suppress the audit row.
        IF v_changed_columns IS NULL THEN
            RETURN NEW;
        END IF;
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

-- Recreate the api_keys audit trigger with skip:last_used_at,last_used_ip so that
-- high-frequency "touch last-used metadata" updates don't generate audit rows.
-- INSERT and DELETE are still fully audited.
DROP TRIGGER IF EXISTS audit_tenant_api_keys ON api_keys;--> statement-breakpoint
CREATE TRIGGER audit_api_keys
    AFTER INSERT OR UPDATE OR DELETE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id', 'key_hash', 'skip:last_used_at,last_used_ip,updated_at');--> statement-breakpoint

-- Recreate the passkey_credentials audit trigger with skip:last_used_at,counter so that
-- per-authentication updates (last_used_at + counter increment) don't generate audit rows.
-- INSERT and DELETE are still fully audited.
DROP TRIGGER IF EXISTS audit_passkey_credentials ON passkey_credentials;--> statement-breakpoint
CREATE TRIGGER audit_passkey_credentials
    AFTER INSERT OR UPDATE OR DELETE ON passkey_credentials
    FOR EACH ROW EXECUTE FUNCTION capture_db_mutation_audit('pk:id', 'public_key', 'skip:last_used_at,counter,updated_at');--> statement-breakpoint
