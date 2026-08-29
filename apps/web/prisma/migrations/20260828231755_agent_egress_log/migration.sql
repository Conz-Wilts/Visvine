-- Every request an agent's machine made, and what the edge did about it.
-- Written in batches by apps/agent-edge, which owns no rows of its own.
CREATE TABLE "agent_egress_log" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "run_id" TEXT,
    "method" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT,
    "status" INTEGER,
    "bytes" INTEGER,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_egress_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_egress_log_space_id_at_idx" ON "agent_egress_log"("space_id", "at");

CREATE INDEX "agent_egress_log_space_id_agent_name_verdict_idx" ON "agent_egress_log"("space_id", "agent_name", "verdict");

ALTER TABLE "agent_egress_log" ADD CONSTRAINT "agent_egress_log_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
