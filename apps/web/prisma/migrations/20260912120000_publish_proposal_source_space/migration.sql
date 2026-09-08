-- A publish proposal records the space its source note lives in. Rows from
-- before this column were always sourced from the proposer's `me:` space, which
-- is what a null still means to lib/notes/promote.ts.

ALTER TABLE "context_move_proposals" ADD COLUMN "from_space_id" TEXT;
