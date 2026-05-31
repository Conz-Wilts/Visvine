-- Post-removal data cleanup (one-shot, idempotent).
--
-- Run manually via psql against any long-lived / production database:
--   psql "$DATABASE_URL" -f apps/web/migrations/remove_moderator_and_profile_subentities.sql
--
-- Local/dev databases get this for free: `pnpm db:fresh` reseeds without a
-- moderator and drops the orphaned tables via `prisma db push --force-reset`.
-- The shared dev fixture must also be re-published (`pnpm db:publish`) so it
-- no longer carries moderator rows or the dropped tables.
--
-- Context: the `moderator` community role and the structured profile
-- sub-entities (work experience, education, certifications, languages) were
-- removed from the Prisma schema. This reconciles existing data with that
-- schema. Apply it BEFORE `prisma db push` so push sees no destructive drift.

-- 1. Collapse any lingering moderator memberships down to plain members.
--    At runtime an unknown role already resolves to least privilege, but this
--    makes the data explicit so `role` only ever holds 'admin' | 'member'.
UPDATE user_communities SET role = 'member' WHERE role = 'moderator';

-- 2. Drop the now-orphaned profile sub-entity tables. IF EXISTS keeps this
--    safe to re-run; CASCADE clears their person_id foreign keys.
DROP TABLE IF EXISTS work_experience CASCADE;
-- Also cover the plural name any DB provisioned by the orphaned profile_overhaul.sql.
DROP TABLE IF EXISTS work_experiences CASCADE;
DROP TABLE IF EXISTS education CASCADE;
DROP TABLE IF EXISTS certifications CASCADE;
DROP TABLE IF EXISTS profile_languages CASCADE;
