-- AlterTable
ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "design_config" JSONB NOT NULL DEFAULT '{}';
