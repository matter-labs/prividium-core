-- No-op: on a zone-only deployment an org member has no role other than a zone role to hold, so the
-- original purge of cross-scope grants revoked live access. Applied environments skip this file anyway.
SELECT 1;
