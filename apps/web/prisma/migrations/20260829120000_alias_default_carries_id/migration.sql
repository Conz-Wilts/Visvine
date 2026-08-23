-- Put the `id` back on the built-in Admin alias in the COLUMN DEFAULT.
--
-- 20260816120000_alias_stable_ids made an alias's `id` its identity: holding one
-- is the app's only definition of admin (lib/auth.ts#isAdmin), grants point at
-- `SpaceAlias.id`, and `verify:alias-identity` asserts that every stored alias
-- has one. That migration backfilled every EXISTING row correctly.
--
-- What it could not fix, and what 20260827120000_owner_alias_is_admin then
-- re-stated verbatim, is the DEFAULT for the column:
--
--   '[{"name": "Admin", "color": "#b4881b", "admin": true, "system": true, ...}]'
--
-- No `id`. So the backfill was complete on the day it ran and has been leaking
-- ever since: every space created after 2026-08-27 is born with an id-less
-- built-in alias — the one alias every space is guaranteed to have is the one
-- nothing can point at. It survives only because lib/types/context.ts#personAliases
-- grafts `id: ADMIN_ALIAS_ID` back in on READ, so the app behaves while the
-- stored row is wrong; anything reading `spaces.aliases` directly (the verifier,
-- a report, a future migration) sees the hole.
--
-- Two statements: fix the default so it stops happening, then backfill the
-- spaces already created under it. Idempotent — both only touch aliases that
-- are actually missing an id.

-- ── 1. The default for new spaces, now carrying the reserved id ─────────────
ALTER TABLE "spaces" ALTER COLUMN "aliases"
  SET DEFAULT '[{"id": "admin", "name": "Admin", "color": "#b4881b", "admin": true, "system": true, "nodeType": "Person"}]';

-- ── 2. Backfill the spaces born without it ──────────────────────────────────
-- Same rule as the original stable-ids backfill: the built-in Admin alias takes
-- the reserved id `admin` (lib/types/context.ts#ADMIN_ALIAS_ID), because a
-- generated one would differ per space. Anything else id-less gets `al_<uuid>`.
UPDATE "spaces"
SET "aliases" = (
  SELECT jsonb_agg(
           CASE
             WHEN a ? 'id' AND a->>'id' <> '' THEN a
             WHEN lower(a->>'name') = 'admin' THEN a || jsonb_build_object('id', 'admin')
             ELSE a || jsonb_build_object('id', 'al_' || gen_random_uuid()::text)
           END
           ORDER BY ord
         )
  FROM jsonb_array_elements("aliases") WITH ORDINALITY AS t(a, ord)
)
WHERE "aliases" IS NOT NULL
  AND jsonb_typeof("aliases") = 'array'
  AND jsonb_array_length("aliases") > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("aliases") a
    WHERE NOT (a ? 'id') OR a->>'id' = ''
  );
