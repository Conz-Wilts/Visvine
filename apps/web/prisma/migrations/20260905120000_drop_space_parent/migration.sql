-- Spaces no longer nest. A space is a tenant, full stop: no parent, no
-- inherited visibility, no sibling-name namespace. Any space that was a child
-- becomes an ordinary root space, keeping its own context, members and aliases.

-- A space that inherited its parent's visibility now stands on its own, and the
-- safe reading of "whatever the parent said" is private.
UPDATE "spaces" SET "visibility" = 'private' WHERE "visibility" = 'inherit';

ALTER TABLE "spaces" DROP CONSTRAINT IF EXISTS "spaces_visibility_check";
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_visibility_check"
  CHECK ("visibility" IN ('public', 'private')) NOT VALID;

-- The sibling-name index was applied out of band (prisma/sql/), so drop it here
-- rather than leaving an index on a column that is about to go.
DROP INDEX IF EXISTS "spaces_sibling_name_unique";

DROP INDEX IF EXISTS "spaces_parent_id_idx";
ALTER TABLE "spaces" DROP CONSTRAINT IF EXISTS "spaces_parent_id_fkey";
ALTER TABLE "spaces" DROP COLUMN IF EXISTS "parent_id";
