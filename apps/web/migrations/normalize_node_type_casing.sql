-- Normalize nodes.type to lowercase-canonical.
--
-- The hot read paths filter on exact lowercase type values
-- (apps/web/lib/eventRepo.ts: type='event'; the message-mention search:
-- type='event'), while several historical write paths stored capitalized
-- values ('Event', 'Person', 'Organization', ...). Type→config resolution for
-- rendering is already case-insensitive (lib/types.ts getNodeTypeConfig), so
-- lowercasing is safe and makes the sensitive readers correct.
--
-- All current write paths now emit lowercase (the node create/update API
-- lowercases on write; seed.ts and scripts/add-nz-ecosystem.mjs write lowercase).
-- This one-off backfills any long-lived DB. Dev fixtures are rebuilt from seed,
-- so they don't need it. Idempotent — safe to re-run.

UPDATE nodes SET type = lower(type) WHERE type <> lower(type);
