-- Drop the Tasks kanban board (added in 20260716_add_tasks). The feature and all
-- of its code are gone, so the tables go with it. `tasks` FKs `task_columns`,
-- so it drops first; CASCADE cleans up the indexes either way.

DROP TABLE IF EXISTS "tasks" CASCADE;
DROP TABLE IF EXISTS "task_columns" CASCADE;
