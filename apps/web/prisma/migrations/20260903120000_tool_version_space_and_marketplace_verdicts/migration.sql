-- Publishing a Tool and listing it on the marketplace become two decisions.
--
-- `status` keeps its four values but changes WHOSE verdict it is: the source
-- space's own. `marketplace_status` is Visvine's, and is NULL until an admin
-- explicitly submits the version — which is what stops a Tool written in a
-- private space from reaching the global shelf by the act of publishing it.
ALTER TABLE "app_tool_versions"
  ADD COLUMN IF NOT EXISTS "marketplace_status"       TEXT,
  ADD COLUMN IF NOT EXISTS "marketplace_submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "marketplace_reviewed_by"  TEXT,
  ADD COLUMN IF NOT EXISTS "marketplace_reviewed_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "marketplace_review_note"  TEXT;

-- Every row that already exists WAS a marketplace submission — that was the
-- only kind of publish there was — so its verdict moves across whole.
UPDATE "app_tool_versions"
   SET "marketplace_status"       = "status",
       "marketplace_submitted_at" = "submitted_at",
       "marketplace_reviewed_by"  = "reviewed_by",
       "marketplace_reviewed_at"  = "reviewed_at",
       "marketplace_review_note"  = "review_note";

-- ...and the space half of the verdict is granted retroactively, because
-- publishing was already an admin-only act: an admin pressing Publish under the
-- old rules is exactly the approval the new `status` column records. A version
-- its own space never shipped — rejected, withdrawn — keeps that standing
-- rather than becoming installable by the rename.
UPDATE "app_tool_versions"
   SET "status"      = 'approved',
       "reviewed_by" = COALESCE("reviewed_by", 'migration'),
       "reviewed_at" = COALESCE("reviewed_at", "submitted_at"),
       "review_note" = NULL
 WHERE "status" IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS "app_tool_versions_marketplace_status_idx"
  ON "app_tool_versions" ("marketplace_status", "marketplace_submitted_at");
