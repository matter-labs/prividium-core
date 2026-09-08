-- Add index on template_key for efficient grouping queries
CREATE INDEX IF NOT EXISTS "idx_contracts_template_key" ON "contracts" ("template_key");
