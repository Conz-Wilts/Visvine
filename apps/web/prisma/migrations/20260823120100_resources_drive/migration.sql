-- The Drive grows up: Resources become real object-storage records wired into
-- the RAG pipeline that context_sources already runs.
--
-- The Resources tool was built as "upload a file, get a card". Everything the
-- rest of the platform learned about blobs afterwards — a first-class gcsPath
-- column, extraction, chunking, embedding, ranked retrieval — landed on
-- context_sources instead, so the product ended up with two half-built file
-- systems and the one users actually upload into was the weaker half.
--
-- Four defects are closed here.
--
-- 1. NO FOREIGN KEY. resources.space_id referenced nothing. Deleting a space
--    left its rows behind unless a caller remembered to sweep them by hand, and
--    exactly one route did. Now ON DELETE CASCADE, like every other space-scoped
--    table.
--
-- 2. THE BLOB POINTER LIVED IN A JSON BLOB, POSTED BY THE BROWSER. The GCS
--    object path was metadata->>'gcsPath', supplied by the client on create and
--    then handed straight to the signed-URL minter on every read. A crafted
--    create could therefore name ANY object in the shared resources bucket —
--    including another space's context-source originals — and be issued a signed
--    download URL for it. Promoted to a server-minted column; the API no longer
--    accepts one from a client at all.
--
-- 3. file_url STORED AN EXPIRING SIGNED URL. Signed for 15 minutes, persisted
--    forever, and papered over by re-signing on every list. A URL is not an
--    identifier. Nothing writes it now; it is nulled wherever we can prove it
--    was one of ours, and kept nullable for legacy rows holding a real link.
--
-- 4. CONTENTS WERE INVISIBLE TO RETRIEVAL. A drive whose documents the AI cannot
--    read is a folder with extra steps. source_path points at the ContextSource
--    holding this file's chunks, and index_state says where it got to.
--
-- Expand-only and backfilled: safe to deploy ahead of the code that uses it. The
-- contract step (dropping file_url, dropping the old metadata key) comes later.

-- ─── 1. New columns ──────────────────────────────────────────────────────────

ALTER TABLE "resources" ADD COLUMN "gcs_path"    TEXT;
ALTER TABLE "resources" ADD COLUMN "source_path" TEXT;
ALTER TABLE "resources" ADD COLUMN "index_state" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "resources" ADD COLUMN "index_error" TEXT;

-- ─── 2. Backfill the pointer out of the JSON blob ────────────────────────────

UPDATE "resources"
   SET "gcs_path" = "metadata" ->> 'gcsPath'
 WHERE "metadata" ? 'gcsPath'
   AND COALESCE(btrim("metadata" ->> 'gcsPath'), '') <> '';

-- Rows that predate the metadata key stored the object path directly in
-- file_url (before signed URLs were introduced). Those are recoverable: a value
-- that is not a URL and not a legacy /uploads path IS the object path.
UPDATE "resources"
   SET "gcs_path" = "file_url"
 WHERE "gcs_path" IS NULL
   AND "file_url" IS NOT NULL
   AND "file_url" NOT LIKE 'http%'
   AND "file_url" NOT LIKE '/uploads%';

-- ─── 3. Retire the stored signed URLs ────────────────────────────────────────

-- Only the ones we can prove are ours and therefore expired: a GCS URL carrying
-- a V4 signature. Anything else (an external link someone pasted, a legacy
-- /uploads path) is left exactly as it is.
ALTER TABLE "resources" ALTER COLUMN "file_url" DROP NOT NULL;

UPDATE "resources"
   SET "file_url" = NULL
 WHERE "file_url" LIKE '%storage.googleapis.com%'
    OR "file_url" LIKE '%X-Goog-Signature%';

-- ─── 4. Mark what the pipeline has not seen ──────────────────────────────────

-- Every pre-existing row is un-indexed by definition: the pipeline did not exist
-- for them. 'pending' is the honest state and the backfill script
-- (scripts/reindex-resources.ts) is what moves them on; images and other
-- text-free kinds are settled to 'unsupported' here since no run will ever
-- index them.
UPDATE "resources"
   SET "index_state" = 'unsupported'
 WHERE lower("file_type") IN ('image', 'img', 'png', 'jpg', 'jpeg', 'gif', 'webp');

-- ─── 5. The missing foreign key ──────────────────────────────────────────────

-- Adopt any orphans first, or the constraint cannot be created. These are rows
-- whose space was deleted before this migration existed — the exact leak the FK
-- prevents from here on. Their GCS objects are unreferenced either way; this
-- deletes the dangling records, not recoverable data.
DELETE FROM "resource_changes"
 WHERE "resource_id" IN (
   SELECT r."id" FROM "resources" r
    LEFT JOIN "spaces" s ON s."id" = r."space_id"
    WHERE s."id" IS NULL
 );

DELETE FROM "resource_comments"
 WHERE "resource_id" IN (
   SELECT r."id" FROM "resources" r
    LEFT JOIN "spaces" s ON s."id" = r."space_id"
    WHERE s."id" IS NULL
 );

DELETE FROM "resources" r
 WHERE NOT EXISTS (SELECT 1 FROM "spaces" s WHERE s."id" = r."space_id");

ALTER TABLE "resources"
  ADD CONSTRAINT "resources_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 6. Index the read the Drive actually does ───────────────────────────────

-- The list is always "this space's files, newest first"; the bare space_id index
-- left the sort to a heap sort on every open.
DROP INDEX IF EXISTS "resources_space_id_idx";
CREATE INDEX "resources_space_id_created_at_idx"
  ON "resources"("space_id", "created_at" DESC);
