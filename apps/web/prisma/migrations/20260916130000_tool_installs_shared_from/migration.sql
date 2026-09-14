-- A Tool the house shares (`share:` on tools/<name>/index.md) is installed in
-- each named room as a real install row stamped with the house it came from
-- (lib/tools/share.ts). The stamp is what tells a room's console it is not
-- theirs to uninstall or upgrade, and what lets the house take it back.
-- Cascade: the house going away takes its shared installs with it.
ALTER TABLE "app_tool_installs" ADD COLUMN "shared_from_space_id" TEXT;

ALTER TABLE "app_tool_installs"
  ADD CONSTRAINT "app_tool_installs_shared_from_space_id_fkey"
  FOREIGN KEY ("shared_from_space_id") REFERENCES "spaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "app_tool_installs_shared_from_space_id_idx" ON "app_tool_installs"("shared_from_space_id");
