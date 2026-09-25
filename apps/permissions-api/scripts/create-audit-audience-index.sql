-- Run after migration 0088 in autocommit mode; concurrent builds cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_audit_logs_affected_organization_ids"
    ON "audit_logs" USING gin ("affected_organization_ids");
