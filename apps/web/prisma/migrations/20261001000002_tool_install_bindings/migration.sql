-- What an install bound each of its Tool's slots to, and its settings.

-- AlterTable
ALTER TABLE "app_tool_installs" ADD COLUMN     "bindings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

