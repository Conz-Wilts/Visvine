-- CreateTable
CREATE TABLE "connector_requests" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recipe" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "connector_name" TEXT,

    CONSTRAINT "connector_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connector_requests_space_id_status_idx" ON "connector_requests"("space_id", "status");

-- CreateIndex
CREATE INDEX "connector_requests_user_id_idx" ON "connector_requests"("user_id");

-- AddForeignKey
ALTER TABLE "connector_requests" ADD CONSTRAINT "connector_requests_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_requests" ADD CONSTRAINT "connector_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The status vocabulary is closed (tests/schema-constraints.test.ts).
ALTER TABLE "connector_requests" ADD CONSTRAINT "connector_requests_status_check"
  CHECK ("status" IN ('pending', 'added', 'dismissed'));
