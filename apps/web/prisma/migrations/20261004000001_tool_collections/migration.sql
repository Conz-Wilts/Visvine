-- CreateTable
CREATE TABLE "app_tool_records" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "tool_key" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "detached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tool_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_tool_records_target_key_collection_created_at_id_idx" ON "app_tool_records"("target_key", "collection", "created_at", "id");

-- CreateIndex
CREATE INDEX "app_tool_records_target_key_collection_user_id_idx" ON "app_tool_records"("target_key", "collection", "user_id");

-- CreateIndex
CREATE INDEX "app_tool_records_space_id_tool_key_idx" ON "app_tool_records"("space_id", "tool_key");

-- CreateIndex
CREATE INDEX "app_tool_records_detached_at_idx" ON "app_tool_records"("detached_at");

-- CreateIndex
CREATE INDEX "app_tool_records_user_id_idx" ON "app_tool_records"("user_id");

-- AddForeignKey
ALTER TABLE "app_tool_records" ADD CONSTRAINT "app_tool_records_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_tool_records" ADD CONSTRAINT "app_tool_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

