-- AlterTable
ALTER TABLE "resources" ADD COLUMN     "conversation_id" TEXT;
-- AlterTable
ALTER TABLE "link_previews" ADD COLUMN     "author_name" TEXT,
ADD COLUMN     "favicon_url" TEXT,
ADD COLUMN     "image_layout" TEXT,
ADD COLUMN     "media_type" TEXT;
-- AlterTable
ALTER TABLE "message_link_previews" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- CreateTable
CREATE TABLE "message_files" (
    "message_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "message_files_pkey" PRIMARY KEY ("message_id","resource_id")
);
-- CreateIndex
CREATE INDEX "message_files_resource_id_idx" ON "message_files"("resource_id");
-- CreateIndex
CREATE INDEX "resources_space_id_conversation_id_idx" ON "resources"("space_id", "conversation_id");
-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "message_files" ADD CONSTRAINT "message_files_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "message_files" ADD CONSTRAINT "message_files_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
