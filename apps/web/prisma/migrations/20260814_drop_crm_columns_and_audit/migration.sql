-- Drop the CRM custom-column system, the audit log, and three vestigial columns.
--
-- The column system (community_columns / community_column_values /
-- community_column_requests / private_columns / private_column_values /
-- value_share_requests) was the storage behind the CRM table that commit
-- 8b94a31 removed. Its twelve /api/crm/* routes had no caller left in web or
-- mobile, and the only thing still writing rows was a seed layer
-- (scripts/add-blackbird-ventures.mjs) whose values were already duplicated
-- verbatim into nodes.metadata. Nothing read them back.
--
-- audit_logs goes with it: eight writers, zero rows, and its only reader was
-- /api/crm/[communityId]/audit. A write-only table is not an audit trail.
--
-- Columns:
--   communities.crm_settings   — field config for the same dead surface
--   communities.data_file      — filename in /data/ecosystems/, from the
--                                JSON-file era; written in four places, read
--                                nowhere. memberCount is now derived from a
--                                filtered relation count instead of a
--                                hand-maintained counter (it was incremented
--                                and decremented across four separate files).
--   communities.member_count   — see above
--   conversations.dm_key       — never written; nothing in the codebase creates
--                                a DM, so the unique key had no rows to key.
--
-- Children before parents, though the FKs cascade either way.

DROP TABLE IF EXISTS "value_share_requests" CASCADE;
DROP TABLE IF EXISTS "private_column_values" CASCADE;
DROP TABLE IF EXISTS "private_columns" CASCADE;
DROP TABLE IF EXISTS "community_column_values" CASCADE;
DROP TABLE IF EXISTS "community_columns" CASCADE;
DROP TABLE IF EXISTS "community_column_requests" CASCADE;
DROP TABLE IF EXISTS "audit_logs" CASCADE;

ALTER TABLE "communities" DROP COLUMN IF EXISTS "crm_settings";
ALTER TABLE "communities" DROP COLUMN IF EXISTS "data_file";
ALTER TABLE "communities" DROP COLUMN IF EXISTS "member_count";

ALTER TABLE "conversations" DROP COLUMN IF EXISTS "dm_key";
