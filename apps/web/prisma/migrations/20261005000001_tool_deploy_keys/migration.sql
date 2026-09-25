-- CreateTable
CREATE TABLE "app_tool_deploy_keys" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,

    CONSTRAINT "app_tool_deploy_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_tool_deploy_keys_key_hash_key" ON "app_tool_deploy_keys"("key_hash");

-- CreateIndex
CREATE INDEX "app_tool_deploy_keys_space_id_tool_name_idx" ON "app_tool_deploy_keys"("space_id", "tool_name");

-- CreateIndex
CREATE INDEX "app_tool_deploy_keys_created_by_idx" ON "app_tool_deploy_keys"("created_by");

-- AddForeignKey
ALTER TABLE "app_tool_deploy_keys" ADD CONSTRAINT "app_tool_deploy_keys_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_tool_deploy_keys" ADD CONSTRAINT "app_tool_deploy_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

