-- A run-in copy (docs/sub-spaces.md): a house brief marked `share_as: run-in`
-- runs once per room it is shared with and the house governs. The copy is a
-- state row IN THE ROOM naming the house whose brief it runs; the brief is
-- read from there, the run reads and writes the room. Null = the row's own
-- brief lives in its own space, as every row did before.
ALTER TABLE "agent_state" ADD COLUMN "shared_from" TEXT;
CREATE INDEX "agent_state_shared_from_idx" ON "agent_state"("shared_from");
