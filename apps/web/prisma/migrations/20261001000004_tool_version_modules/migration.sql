-- A published version keeps the interface's own modules (src/<name>.tsx)
-- beside ui.tsx, for review and export; every version so far has none.

-- AlterTable
ALTER TABLE "app_tool_versions" ADD COLUMN     "modules" JSONB NOT NULL DEFAULT '{}';
