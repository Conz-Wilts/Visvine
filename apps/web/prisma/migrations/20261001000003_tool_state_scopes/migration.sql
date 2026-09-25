-- A Tool's state gains a scope: '' is the value every viewer of the install
-- shares (what every row so far is), a viewer's id is their own.

-- DropIndex
DROP INDEX "app_tool_state_install_id_key_key";

-- AlterTable
ALTER TABLE "app_tool_state" ADD COLUMN     "user_id" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "app_tool_state_user_id_idx" ON "app_tool_state"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_tool_state_install_id_user_id_key_key" ON "app_tool_state"("install_id", "user_id", "key");
