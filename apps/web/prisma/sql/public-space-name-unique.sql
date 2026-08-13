-- Public spaces must have distinct names; private ones may be called anything.
--
-- The rule is enforced in the app (lib/spaces/publicName.ts) on every write
-- path that can leave a space public. That check is check-then-write, so this
-- partial index is the race backstop: two concurrent publishes of the same name
-- can both pass the check, only one can pass this.
--
-- Partial + expression, so Prisma cannot express it in schema.prisma — it is
-- applied out of band by scripts/apply-sql-functions.mjs (local) and
-- scripts/prod-schema-presync.mjs (deploy). Idempotent, like everything there.
--
-- The expression MUST stay identical to normalizePublicName() in
-- lib/spaces/publicName.ts, or the app check and this index disagree.
-- Personal spaces (me:<userId>) are always private, so the visibility predicate
-- already excludes them; the explicit clause keeps a repaired row from tripping it.
CREATE UNIQUE INDEX IF NOT EXISTS spaces_public_name_unique
  ON spaces (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
  WHERE visibility = 'public' AND personal_owner_id IS NULL;
