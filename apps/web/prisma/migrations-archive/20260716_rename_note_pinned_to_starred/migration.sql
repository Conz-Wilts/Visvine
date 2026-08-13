-- The sidebar's "pin" system becomes a "star" system unified with the editor's
-- frontmatter `starred:` flag. Rename the column (existing pins carry over as
-- stars) and backfill from any note whose frontmatter already says starred: true,
-- so both sources agree from day one. From here on the column is a synced index:
-- every note write re-derives it from the frontmatter.

-- 1. Rename the column: pinned notes stay starred.
ALTER TABLE "community_notes" RENAME COLUMN "pinned" TO "starred";

-- 2. Backfill from frontmatter. split_part(content, E'\n---', 1) isolates the
--    leading `---` YAML block (everything before the closing delimiter), so a
--    literal "starred: true" in the body doesn't false-positive.
UPDATE "community_notes"
SET "starred" = true
WHERE "starred" = false
  AND "content" LIKE '---%'
  AND split_part("content", E'\n---', 1) ~* E'(^|\\n)starred\\s*:\\s*true';
