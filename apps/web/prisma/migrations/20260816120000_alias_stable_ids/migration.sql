-- Give every space alias a stable id, and point everything that referenced one
-- by NAME at that id instead.
--
-- An alias lives inside the `spaces.aliases` JSON array and had no identity of
-- its own, so its name was its primary key. Three places stored that name by
-- value: `user_aliases.alias_name` (who holds it), `context_grants.subject_id`
-- (what it grants) and `nodes.alias` (the chip on a directory card). Holding an
-- alias flagged `owner` is the app's ONLY definition of admin, so any drift
-- between those copies — a casing mismatch, a rename that half-applied —
-- silently revoked people's access.
--
-- After this, a rename is one write to `spaces.aliases` and nothing else moves.
--
-- The backfill runs inside this migration rather than in a separate script, so
-- `prisma migrate deploy` carries it to production with the schema change and
-- there is no window where the two are out of step. Everything here is
-- idempotent enough to be safe on a re-run: ids are only stamped where missing.

-- ── 1. Stamp an id onto every stored alias that lacks one ────────────────────
-- The built-in Owner alias gets the reserved id `owner` (lib/types/context.ts
-- #OWNER_ALIAS_ID). Most spaces never store it — the app grafts it in on read —
-- so a generated id would differ per space and per graft, and the one alias
-- every space is guaranteed to have would be the one nothing could point at.
UPDATE "spaces"
SET "aliases" = (
  SELECT jsonb_agg(
           CASE
             WHEN a ? 'id' AND a->>'id' <> '' THEN a
             WHEN lower(a->>'name') = 'owner' THEN a || jsonb_build_object('id', 'owner')
             ELSE a || jsonb_build_object('id', 'al_' || gen_random_uuid()::text)
           END
           ORDER BY ord
         )
  FROM jsonb_array_elements("aliases") WITH ORDINALITY AS t(a, ord)
)
WHERE "aliases" IS NOT NULL
  AND jsonb_typeof("aliases") = 'array'
  AND jsonb_array_length("aliases") > 0;

-- ── 2. The new columns, nullable while the backfill runs ─────────────────────
ALTER TABLE "user_aliases" ADD COLUMN "alias_id" TEXT;
ALTER TABLE "nodes" ADD COLUMN "alias_id" TEXT;

-- ── 3. Backfill the holders ──────────────────────────────────────────────────
-- Exact name first, then a case-insensitive pass. The second one is a repair:
-- MCP's add_context validated an alias case-insensitively and then stored what
-- the caller typed, so `founder` rows exist against a `Founder` vocabulary and
-- have been matching nothing ever since. Finally `owner` by name, for the usual
-- case where the built-in alias was never written to the array at all.
UPDATE "user_aliases" ua
SET "alias_id" = COALESCE(
  (SELECT a->>'id' FROM "spaces" s, jsonb_array_elements(s."aliases") a
    WHERE s."id" = ua."space_id" AND a->>'name' = ua."alias_name" LIMIT 1),
  (SELECT a->>'id' FROM "spaces" s, jsonb_array_elements(s."aliases") a
    WHERE s."id" = ua."space_id" AND lower(a->>'name') = lower(ua."alias_name") LIMIT 1),
  CASE WHEN lower(ua."alias_name") = 'owner' THEN 'owner' END
);

-- ── 4. Backfill the grants ───────────────────────────────────────────────────
UPDATE "context_grants" g
SET "subject_id" = COALESCE(
  (SELECT a->>'id' FROM "spaces" s, jsonb_array_elements(s."aliases") a
    WHERE s."id" = g."space_id" AND a->>'name' = g."subject_id" LIMIT 1),
  (SELECT a->>'id' FROM "spaces" s, jsonb_array_elements(s."aliases") a
    WHERE s."id" = g."space_id" AND lower(a->>'name') = lower(g."subject_id") LIMIT 1),
  CASE WHEN lower(g."subject_id") = 'owner' THEN 'owner' END,
  g."subject_id"
)
WHERE g."subject_type" = 'alias';

-- ── 5. Backfill the directory chips ──────────────────────────────────────────
-- `nodes.alias` is overloaded: for an event it holds the public /e/<slug> slug,
-- for a connector the executor kind. Neither is vocabulary, and either could
-- coincide with an alias name — so the match is constrained to aliases scoped to
-- the node's OWN type. Types are compared canonically, because an org node may
-- still be stored under a retired spelling (organization → group → community →
-- space) while the alias records the current one.
UPDATE "nodes" n
SET "alias_id" = (
  SELECT a->>'id'
  FROM "spaces" s, jsonb_array_elements(s."aliases") a
  WHERE s."id" = n."space_id"
    AND lower(a->>'name') = lower(n."alias")
    AND CASE
          WHEN lower(a->>'nodeType') IN ('organization','organisation','org','group','groups',
                                         'company','companies','community','communities','space','spaces')
          THEN 'space' ELSE lower(a->>'nodeType')
        END
      = CASE
          WHEN lower(n."type") IN ('organization','organisation','org','group','groups',
                                   'company','companies','community','communities','space','spaces')
          THEN 'space' ELSE lower(n."type")
        END
  LIMIT 1
)
WHERE n."alias" IS NOT NULL AND n."space_id" IS NOT NULL;

-- ── 6. Drop what could not be resolved ───────────────────────────────────────
-- These rows already pointed at a name no alias in their space carries, so they
-- have been inert for as long as they have existed — a holder nobody counted, a
-- grant that matched nothing. They cannot be carried forward, and leaving them
-- would block the NOT NULL below.
DELETE FROM "user_aliases" WHERE "alias_id" IS NULL;
DELETE FROM "context_grants"
WHERE "subject_type" = 'alias'
  AND NOT EXISTS (
    SELECT 1 FROM "spaces" s, jsonb_array_elements(s."aliases") a
    WHERE s."id" = "context_grants"."space_id" AND a->>'id' = "context_grants"."subject_id"
  )
  AND "subject_id" <> 'owner';

-- ── 7. Swap the constraints over ─────────────────────────────────────────────
DROP INDEX "user_aliases_space_id_alias_name_idx";
DROP INDEX "user_aliases_space_id_user_id_alias_name_key";

ALTER TABLE "user_aliases" ALTER COLUMN "alias_id" SET NOT NULL;
ALTER TABLE "user_aliases" DROP COLUMN "alias_name";

CREATE INDEX "user_aliases_space_id_alias_id_idx" ON "user_aliases"("space_id", "alias_id");
CREATE UNIQUE INDEX "user_aliases_space_id_user_id_alias_id_key" ON "user_aliases"("space_id", "user_id", "alias_id");
CREATE INDEX "nodes_space_id_alias_id_idx" ON "nodes"("space_id", "alias_id");
