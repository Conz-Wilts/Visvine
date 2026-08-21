-- The Drive gets folders.
--
-- A folder is organisational only: a file indexes, searches and previews the
-- same wherever it sits, so nothing downstream of the Resource row changes.
-- The root is the absence of a folder (folder_id IS NULL), not a row, which is
-- what keeps "move to root" a plain NULL write.
--
-- Deleting a folder cascades to its subfolders; the files inside are moved to
-- the deleted folder's parent by the service before the row goes, so the
-- SET NULL on resources.folder_id is a backstop and not the behaviour.

CREATE TABLE "resource_folders" (
  "id"         TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "space_id"   TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "parent_id"  TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resource_folders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resource_folders_space_id_parent_id_idx"
  ON "resource_folders"("space_id", "parent_id");

ALTER TABLE "resource_folders"
  ADD CONSTRAINT "resource_folders_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resource_folders"
  ADD CONSTRAINT "resource_folders_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "resource_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resources" ADD COLUMN "folder_id" TEXT;

CREATE INDEX "resources_space_id_folder_id_idx"
  ON "resources"("space_id", "folder_id");

ALTER TABLE "resources"
  ADD CONSTRAINT "resources_folder_id_fkey"
  FOREIGN KEY ("folder_id") REFERENCES "resource_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
