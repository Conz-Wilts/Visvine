-- A Tool's structured facts as a row, and every change to them (lib/tools/toolFacts.ts).

-- CreateTable
CREATE TABLE "app_tool_configs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facts" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tool_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_tool_config_changes" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tool_config_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_tool_configs_space_id_name_key" ON "app_tool_configs"("space_id", "name");

-- CreateIndex
CREATE INDEX "app_tool_config_changes_space_id_name_created_at_idx" ON "app_tool_config_changes"("space_id", "name", "created_at");

-- AddForeignKey
ALTER TABLE "app_tool_configs" ADD CONSTRAINT "app_tool_configs_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_tool_config_changes" ADD CONSTRAINT "app_tool_config_changes_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

