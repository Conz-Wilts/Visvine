-- AlterTable
ALTER TABLE "agent_state" DROP COLUMN "schedule_hash",
ADD COLUMN     "agents" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "configured_at" TIMESTAMP(3),
ADD COLUMN     "connectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "dry_run" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "max_turns" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "runs_as" TEXT,
ADD COLUMN     "schedule" JSONB,
ADD COLUMN     "share_as" TEXT NOT NULL DEFAULT 'use',
ADD COLUMN     "share_mode" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "share_rooms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updated_by" TEXT;

-- AlterTable
ALTER TABLE "agent_subscriptions" ADD COLUMN     "at" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "agent_config_changes" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" TEXT,
    "patch" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_config_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_config_changes_space_id_name_at_idx" ON "agent_config_changes"("space_id", "name", "at" DESC);

-- AddForeignKey
ALTER TABLE "agent_config_changes" ADD CONSTRAINT "agent_config_changes_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

