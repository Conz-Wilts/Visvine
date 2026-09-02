-- DropIndex
DROP INDEX "agent_events_dedupe_key";

-- DropIndex
DROP INDEX "agent_events_pending_idx";

-- AlterTable
ALTER TABLE "agent_state" ADD COLUMN     "brief_note_id" TEXT;
