-- Pre-validation origins must match URL.origin form: CORS compares them verbatim against the Origin header.
UPDATE "applications"
SET "origin" = lower(regexp_replace(btrim("origin"), '^(https?://[^/?#]+).*$', '\1', 'i'))
WHERE btrim("origin") ~* '^https?://';--> statement-breakpoint
UPDATE "applications"
SET "origin" = left("origin", -4)
WHERE "origin" LIKE 'https://%:443';--> statement-breakpoint
UPDATE "applications"
SET "origin" = left("origin", -3)
WHERE "origin" LIKE 'http://%:80';
