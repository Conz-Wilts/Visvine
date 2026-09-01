-- The agent_events partial indexes (pending per agent; unique dedupe_key while
-- pending) are HAND-WRITTEN in 20260820120000_agent_events because Prisma
-- cannot express a WHERE clause — `prisma migrate dev` regenerates their drop
-- here every time. Never let that drop ship: the dedupe index is behavioural.

-- CreateTable
CREATE TABLE "agent_model_prices" (
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_per_m" DOUBLE PRECISION NOT NULL,
    "output_per_m" DOUBLE PRECISION NOT NULL,
    "cached_input_per_m" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_model_prices_pkey" PRIMARY KEY ("provider","model")
);
