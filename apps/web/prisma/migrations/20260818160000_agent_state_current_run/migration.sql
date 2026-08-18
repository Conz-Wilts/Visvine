-- agent_state.current_run_id: which run holds the row's `running` claim.
--
-- Before this, releasing the row after a run was an unconditional
-- `SET status = 'idle'`. That is wrong the moment the row has been RECLAIMED:
-- the tick reclaims rows stuck in `running` past the run cap and may re-claim
-- the same agent for a fresh run; if the old run then finishes late (its own
-- timeout fires at the very same instant the reclaim cutoff does), its release
-- flips the row idle under the NEW run — a third run can start while the
-- second is still in flight, and the failure count is bumped twice.
--
-- With the claim naming its run, release becomes a compare-and-swap:
-- `UPDATE ... WHERE current_run_id = <me>`. A late release from a reclaimed
-- run matches nothing and does no bookkeeping (the reclaim already did it).
--
-- Nullable, no backfill: a row that is `running` when this deploys was claimed
-- by the old code and will be reclaimed by the tick on its normal timeout;
-- until then its release finds current_run_id NULL and leaves the row alone.

ALTER TABLE "agent_state" ADD COLUMN "current_run_id" TEXT;
