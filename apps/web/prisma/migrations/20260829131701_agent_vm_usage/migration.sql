-- How much machine a space has used this month. Awake seconds are what a
-- machine costs, so they are what a quota counts.
CREATE TABLE "agent_vm_usage" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "execs" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_vm_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_vm_usage_space_id_month_key" ON "agent_vm_usage"("space_id", "month");

ALTER TABLE "agent_vm_usage" ADD CONSTRAINT "agent_vm_usage_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
