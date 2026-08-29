-- One agent's machine: the lease, not the machine itself. Every request
-- re-derives the container from this row; nothing holds a handle across one.
CREATE TABLE "agent_vms" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "substrate" TEXT NOT NULL DEFAULT 'cloudflare',
    "substrate_name" TEXT NOT NULL,
    "instance_type" TEXT NOT NULL DEFAULT 'standard-3',
    "image_digest" TEXT,
    "state" TEXT NOT NULL DEFAULT 'provisioning',
    "policy_hash" TEXT,
    "workspace_key" TEXT NOT NULL,
    "last_active_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_vms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_vms_state_last_active_at_idx" ON "agent_vms"("state", "last_active_at");

CREATE UNIQUE INDEX "agent_vms_space_id_agent_name_key" ON "agent_vms"("space_id", "agent_name");

ALTER TABLE "agent_vms" ADD CONSTRAINT "agent_vms_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
