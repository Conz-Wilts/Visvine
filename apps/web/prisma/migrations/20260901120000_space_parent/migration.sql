-- Spaces nest (docs/sub-spaces.md). A child space is a full tenant that lives
-- inside its parent; the column is the only schema it needs. Restrict rather
-- than cascade: a parent with children is deleted depth-first by the caller,
-- never wiped by the database.
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "parent_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "spaces"
    ADD CONSTRAINT "spaces_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "spaces_parent_id_idx" ON "spaces"("parent_id");

-- A child may inherit its visibility from the parent (lib/spaces/hierarchy.ts).
ALTER TABLE "spaces" DROP CONSTRAINT IF EXISTS "spaces_visibility_check";
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_visibility_check"
  CHECK ("visibility" IN ('public', 'private', 'inherit')) NOT VALID;
