-- add_link_provenance.sql — one-off, idempotent. Run BEFORE `prisma db push`
-- when upgrading an EXISTING links table to the provenance/dedup model
-- (see docs/link-management-design.md §2). On a fresh/empty DB this is a no-op
-- and `prisma db push` creates everything from schema.prisma directly.
--
-- Why before push: `links.pair_key` is NOT NULL in the schema and the new
-- `@@unique([community_id, pair_key, relationship])` index can't be created
-- while duplicates exist. This backfills pair_key, stamps origin, and collapses
-- any duplicate/reversed-pair rows so the subsequent push succeeds cleanly.

-- 1. Columns (nullable add; push later enforces NOT NULL on pair_key/updated_at).
ALTER TABLE links
  ADD COLUMN IF NOT EXISTS origin      text,
  ADD COLUMN IF NOT EXISTS origin_ref  text,
  ADD COLUMN IF NOT EXISTS created_by  text,
  ADD COLUMN IF NOT EXISTS updated_at  timestamp(3),
  ADD COLUMN IF NOT EXISTS pair_key    text;

-- 2. Backfill normalized pair key + provenance for rows that don't have them yet.
UPDATE links SET
  pair_key = LEAST(source_id, target_id) || '|' || GREATEST(source_id, target_id),
  updated_at = COALESCE(updated_at, created_at, now()),
  origin = COALESCE(origin, CASE relationship
    WHEN 'attended'   THEN 'event_attendance'
    WHEN 'hosting'    THEN 'event_hosting'
    WHEN 'introduced' THEN 'intro'
    ELSE 'import'          -- pre-existing curated/imported edges are first-class, not "manual UI"
  END)
WHERE pair_key IS NULL OR origin IS NULL OR updated_at IS NULL;

-- 3. Promote the survivor of any duplicate group to 'manual' if any member is manual
--    (human assertion wins), then collapse duplicates keeping the lowest id.
UPDATE links keep SET origin = 'manual'
FROM links dup
WHERE dup.id <> keep.id
  AND dup.pair_key = keep.pair_key
  AND dup.relationship = keep.relationship
  AND dup.community_id IS NOT DISTINCT FROM keep.community_id
  AND dup.origin = 'manual'
  AND keep.id = (
    SELECT MIN(l2.id) FROM links l2
    WHERE l2.pair_key = keep.pair_key
      AND l2.relationship = keep.relationship
      AND l2.community_id IS NOT DISTINCT FROM keep.community_id
  );

DELETE FROM links l USING links keep
WHERE l.id > keep.id
  AND l.pair_key = keep.pair_key
  AND l.relationship = keep.relationship
  AND l.community_id IS NOT DISTINCT FROM keep.community_id;
