-- CreateEnum
CREATE TYPE "ResourceSource" AS ENUM ('upload', 'link');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('image', 'video', 'audio', 'pdf', 'doc', 'sheet', 'slides', 'text', 'code', 'archive', 'link', 'other');

-- CreateEnum
CREATE TYPE "ResourceState" AS ENUM ('uploading', 'ready', 'failed', 'deleted');

-- CreateEnum
CREATE TYPE "ChannelVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "visibility" "ChannelVisibility" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "resources" ADD COLUMN     "canonical_url" TEXT,
ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by" TEXT,
ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "embed_url" TEXT,
ADD COLUMN     "entity_source" TEXT,
ADD COLUMN     "external" JSONB,
ADD COLUMN     "fetch_state" TEXT,
ADD COLUMN     "fetched_at" TIMESTAMP(3),
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "kind" "ResourceKind" NOT NULL DEFAULT 'other',
ADD COLUMN     "mime_type" TEXT,
ADD COLUMN     "node_id" TEXT,
ADD COLUMN     "page_count" INTEGER,
ADD COLUMN     "preview_path" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "scan_state" TEXT NOT NULL DEFAULT 'skipped',
ADD COLUMN     "source" "ResourceSource" NOT NULL DEFAULT 'upload',
ADD COLUMN     "state" "ResourceState" NOT NULL DEFAULT 'ready',
ADD COLUMN     "unfurl" JSONB,
ADD COLUMN     "url" TEXT,
ADD COLUMN     "width" INTEGER;

-- CreateTable
CREATE TABLE "resource_shares" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "resource_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "shared_by" TEXT,
    "agent_name" TEXT,
    "via" TEXT NOT NULL DEFAULT 'upload',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_renditions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "resource_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "gcs_path" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "mime_type" TEXT NOT NULL DEFAULT 'image/webp',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_renditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_access" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "resource_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "user_id" TEXT,
    "agent_name" TEXT,
    "run_id" TEXT,
    "via" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_node_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_jobs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "resource_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_after" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resource_shares_resource_id_idx" ON "resource_shares"("resource_id");

-- CreateIndex
CREATE INDEX "resource_shares_conversation_id_created_at_idx" ON "resource_shares"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "resource_shares_space_id_created_at_idx" ON "resource_shares"("space_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "resource_shares_message_id_resource_id_key" ON "resource_shares"("message_id", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_renditions_resource_id_kind_key" ON "resource_renditions"("resource_id", "kind");

-- CreateIndex
CREATE INDEX "resource_access_resource_id_at_idx" ON "resource_access"("resource_id", "at" DESC);

-- CreateIndex
CREATE INDEX "resource_access_space_id_at_idx" ON "resource_access"("space_id", "at" DESC);

-- CreateIndex
CREATE INDEX "resource_access_user_id_idx" ON "resource_access"("user_id");

-- CreateIndex
CREATE INDEX "resource_jobs_state_run_after_idx" ON "resource_jobs"("state", "run_after");

-- CreateIndex
CREATE UNIQUE INDEX "resource_jobs_resource_id_kind_key" ON "resource_jobs"("resource_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "resources_node_id_key" ON "resources"("node_id");

-- CreateIndex
CREATE INDEX "resources_space_id_kind_created_at_idx" ON "resources"("space_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "resources_space_id_state_idx" ON "resources"("space_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "resources_space_id_canonical_url_key" ON "resources"("space_id", "canonical_url");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_shared_by_fkey" FOREIGN KEY ("shared_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_renditions" ADD CONSTRAINT "resource_renditions_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_access" ADD CONSTRAINT "resource_access_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_access" ADD CONSTRAINT "resource_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_jobs" ADD CONSTRAINT "resource_jobs_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: the columns an upload row can derive from what it already holds.
UPDATE "resources" SET
  "mime_type" = NULLIF("metadata"->>'mimeType', ''),
  "kind" = (CASE
    WHEN "file_type" = 'image' THEN 'image'
    WHEN "file_type" = 'pdf' THEN 'pdf'
    WHEN "file_type" IN ('docx', 'doc', 'odt', 'rtf') THEN 'doc'
    WHEN "file_type" IN ('xlsx', 'xls', 'csv', 'ods', 'tsv') THEN 'sheet'
    WHEN "file_type" IN ('pptx', 'ppt', 'key', 'odp') THEN 'slides'
    WHEN "file_type" IN ('markdown', 'text', 'txt', 'md') THEN 'text'
    WHEN "file_type" IN ('json', 'js', 'ts', 'py', 'html', 'css', 'xml', 'yaml', 'yml', 'sql') THEN 'code'
    WHEN "file_type" IN ('mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v') THEN 'video'
    WHEN "file_type" IN ('mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac') THEN 'audio'
    WHEN "file_type" IN ('zip', 'gz', 'tar', 'rar', '7z') THEN 'archive'
    ELSE 'other' END)::"ResourceKind",
  "created_by" = (SELECT u."id" FROM "users" u WHERE u."id" = "resources"."uploaded_by");

UPDATE "resources" r SET "node_id" = n."id"
FROM "nodes" n
WHERE n."type" = 'resource' AND n."space_id" = r."space_id" AND n."metadata"->>'fileId' = r."id"
  AND NOT EXISTS (SELECT 1 FROM "resources" o WHERE o."node_id" = n."id");

-- Every Drive file is shared to its space; a channel's file to each message
-- that carried it (or, carried by none, to the channel itself).
INSERT INTO "resource_shares" ("resource_id", "space_id", "shared_by", "via", "created_at")
SELECT r."id", r."space_id", r."created_by", 'upload', r."created_at"
FROM "resources" r WHERE r."conversation_id" IS NULL;

INSERT INTO "resource_shares" ("resource_id", "space_id", "conversation_id", "message_id", "shared_by", "via", "position", "created_at")
SELECT r."id", r."space_id", m."conversation_id", mf."message_id",
       (SELECT u."id" FROM "users" u WHERE u."id" = m."sender_id"), 'message', mf."position", m."created_at"
FROM "message_files" mf
JOIN "resources" r ON r."id" = mf."resource_id"
JOIN "messages" m ON m."id" = mf."message_id";

INSERT INTO "resource_shares" ("resource_id", "space_id", "conversation_id", "shared_by", "via", "created_at")
SELECT r."id", r."space_id", r."conversation_id", r."created_by", 'upload', r."created_at"
FROM "resources" r
WHERE r."conversation_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "message_files" mf WHERE mf."resource_id" = r."id");
