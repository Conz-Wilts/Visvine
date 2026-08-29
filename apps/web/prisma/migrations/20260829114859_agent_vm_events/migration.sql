-- What an agent's machine did, in order — the window's durable half.
CREATE TABLE "agent_vm_events" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "run_id" TEXT,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_vm_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_vm_events_space_id_agent_name_at_idx" ON "agent_vm_events"("space_id", "agent_name", "at");

CREATE INDEX "agent_vm_events_run_id_seq_idx" ON "agent_vm_events"("run_id", "seq");

ALTER TABLE "agent_vm_events" ADD CONSTRAINT "agent_vm_events_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
