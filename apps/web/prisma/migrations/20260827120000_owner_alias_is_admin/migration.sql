-- The alias authority flag is `admin`, and the built-in alias is "Admin"
-- (id `admin`). Both were previously spelled "owner", which collided with the
-- unrelated personal-context owner (owner_key, personal_owner_id) and read as
-- a property claim rather than the permission it is. Rewrite the stored
-- vocabulary and everything that points at the built-in alias by id or name.
--
-- Idempotent: every statement matches only the old spelling.

-- ── 1. A custom alias already named "Admin" would be shadowed by the built-in
-- one (lib/types/context.ts#personAliases grafts by name), so step aside first.
UPDATE "spaces"
SET "aliases" = (
  SELECT jsonb_agg(
           CASE
             WHEN lower(a->>'name') = 'admin' AND COALESCE(a->>'id', '') <> 'owner'
                  AND COALESCE((a->>'system')::boolean, false) IS NOT TRUE
               THEN a || jsonb_build_object('name', (a->>'name') || ' (custom)')
             ELSE a
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
    WHERE lower(a->>'name') = 'admin' AND COALESCE(a->>'id', '') <> 'owner'
  );

-- ── 2. Rename the flag and the built-in alias inside spaces.aliases ──────────
UPDATE "spaces"
SET "aliases" = (
  SELECT jsonb_agg(
           (
             CASE WHEN a ? 'owner'
               THEN (a - 'owner') || jsonb_build_object('admin', (a->'owner'))
               ELSE a
             END
           )
           || CASE WHEN a->>'id' = 'owner' OR lower(a->>'name') = 'owner'
                THEN jsonb_build_object('id', 'admin', 'name', 'Admin')
                ELSE '{}'::jsonb
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
    WHERE a ? 'owner' OR a->>'id' = 'owner' OR lower(a->>'name') = 'owner'
  );

-- ── 3. The column default for new spaces ────────────────────────────────────
ALTER TABLE "spaces" ALTER COLUMN "aliases"
  SET DEFAULT '[{"name": "Admin", "color": "#b4881b", "admin": true, "system": true, "nodeType": "Person"}]';

-- ── 4. Everything that points at the built-in alias by id ───────────────────
-- A user who somehow holds both rows would violate the unique key; drop the
-- duplicate first.
DELETE FROM "user_aliases" ua
WHERE ua."alias_id" = 'owner'
  AND EXISTS (
    SELECT 1 FROM "user_aliases" x
    WHERE x."space_id" = ua."space_id" AND x."user_id" = ua."user_id" AND x."alias_id" = 'admin'
  );
UPDATE "user_aliases" SET "alias_id" = 'admin' WHERE "alias_id" = 'owner';

UPDATE "context_grants" SET "subject_id" = 'admin'
WHERE "subject_type" = 'alias' AND "subject_id" = 'owner';

-- ── 5. Directory chips naming the built-in alias ────────────────────────────
UPDATE "nodes" SET "alias_id" = 'admin' WHERE "alias_id" = 'owner';
UPDATE "nodes" SET "alias" = 'Admin' WHERE "alias_id" = 'admin' AND "alias" = 'Owner';
