-- The agent_events partial indexes (pending per agent; unique dedupe_key while
-- pending) are HAND-WRITTEN in 20260820120000_agent_events because Prisma
-- cannot express a WHERE clause — `prisma migrate dev` regenerates their drop
-- here every time. Never let that drop ship: the dedupe index is behavioural.

-- CreateTable
CREATE TABLE "agent_model_usage" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
    "completion_tokens" BIGINT NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "unpriced_runs" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_model_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_model_usage_space_id_month_name_model_key" ON "agent_model_usage"("space_id", "month", "name", "model");

-- AddForeignKey
ALTER TABLE "agent_model_usage" ADD CONSTRAINT "agent_model_usage_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
