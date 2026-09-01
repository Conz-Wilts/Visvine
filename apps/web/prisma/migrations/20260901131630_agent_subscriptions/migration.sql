-- The agent_events partial indexes (pending per agent; unique dedupe_key while
-- pending) are HAND-WRITTEN in 20260820120000_agent_events because Prisma
-- cannot express a WHERE clause — `prisma migrate dev` regenerates their drop
-- here every time. Never let that drop ship: the dedupe index is behavioural.

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "run_as_user_id" TEXT;

-- Drift catch-up, folded in by `migrate dev`: the emoji columns are phase 2 of
-- the icon rename (prisma/manual/20260818140000_icons_drop_emoji_columns.sql,
-- run BY HAND against prod), so a database may or may not still have them —
-- IF EXISTS keeps this migration deployable either way.

-- AlterTable
ALTER TABLE "channel_sections" DROP COLUMN IF EXISTS "emoji";

-- AlterTable
ALTER TABLE "connector_connections" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "spaces" DROP COLUMN IF EXISTS "emoji";

-- CreateTable
CREATE TABLE "agent_subscriptions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_subscriptions_space_id_name_idx" ON "agent_subscriptions"("space_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "agent_subscriptions_space_id_name_user_id_key" ON "agent_subscriptions"("space_id", "name", "user_id");

-- AddForeignKey
ALTER TABLE "agent_subscriptions" ADD CONSTRAINT "agent_subscriptions_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "connector_connections_identity" RENAME TO "connector_connections_space_id_provider_user_id_key";

-- RenameIndex
ALTER INDEX "connector_connections_space_provider_idx" RENAME TO "connector_connections_space_id_provider_idx";

-- RenameIndex
ALTER INDEX "connector_oauth_clients_identity" RENAME TO "connector_oauth_clients_space_id_provider_issuer_key";

-- RenameIndex
ALTER INDEX "context_source_chunks_space_owner_path_idx" RENAME TO "context_source_chunks_space_id_owner_key_path_idx";
