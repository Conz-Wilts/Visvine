-- A space may hold sub-spaces, one level deep. A sub-space is a full row in
-- this table — its own members, aliases, tools and context — that names the
-- space it lives under. Restrict rather than cascade: deleting a parent with
-- sub-spaces is a children-first delete the route performs on purpose.
ALTER TABLE "spaces" ADD COLUMN "parent_id" TEXT;

ALTER TABLE "spaces"
  ADD CONSTRAINT "spaces_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "spaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "spaces_parent_id_idx" ON "spaces"("parent_id");

-- Sibling names are unique inside one parent, on the same key the public-name
-- index uses (lib/spaces/publicName.ts#normalizePublicName), so two sub-spaces
-- of one space can never be told apart by name alone. Unrelated parents may
-- each have an "Operations".
CREATE UNIQUE INDEX "spaces_sibling_name_unique"
  ON "spaces" ("parent_id", lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')))
  WHERE "parent_id" IS NOT NULL;
