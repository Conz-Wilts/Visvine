/*
  Warnings:

  - You are about to drop the `profile_education` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "profile_education" DROP CONSTRAINT "profile_education_user_id_fkey";

-- DropTable
DROP TABLE "profile_education";

-- CreateTable
CREATE TABLE "profile_sections" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_section_entries" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "section_id" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "description" TEXT,
    "url" TEXT,
    "start_year" TEXT,
    "end_year" TEXT,
    "image_url" TEXT,
    "space_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_section_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_sections_user_id_position_idx" ON "profile_sections"("user_id", "position");

-- CreateIndex
CREATE INDEX "profile_section_entries_section_id_position_idx" ON "profile_section_entries"("section_id", "position");

-- AddForeignKey
ALTER TABLE "profile_sections" ADD CONSTRAINT "profile_sections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_section_entries" ADD CONSTRAINT "profile_section_entries_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "profile_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_section_entries" ADD CONSTRAINT "profile_section_entries_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
