-- The intros feature (warm-introduction requests surfaced in Messages) is
-- removed. Drop its table; graph links created by accepted intros keep their
-- origin/origin_ref values as inert provenance strings.
DROP TABLE IF EXISTS "intro_requests";
