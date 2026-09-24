-- A grant may name a channel: its members read what it grants (a private
-- channel's note, a file shared only in channels — lib/resources/grants.ts).
ALTER TABLE "context_grants" DROP CONSTRAINT "context_grants_subject_type_check";
ALTER TABLE "context_grants" ADD CONSTRAINT "context_grants_subject_type_check"
  CHECK ("subject_type" IN ('space', 'alias', 'user', 'channel'));

-- The closed vocabularies of the resource tables, held the way the other enums
-- in text columns are (20260824120200_enum_check_constraints).
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_via_check"
  CHECK ("via" IN ('upload', 'message', 'link', 'action', 'agent'));
ALTER TABLE "resource_access" ADD CONSTRAINT "resource_access_via_check"
  CHECK ("via" IN ('web', 'mcp', 'agent', 'api'));
ALTER TABLE "resource_access" ADD CONSTRAINT "resource_access_action_check"
  CHECK ("action" IN ('read', 'download', 'upload', 'share', 'use', 'delete'));
ALTER TABLE "resource_jobs" ADD CONSTRAINT "resource_jobs_kind_check"
  CHECK ("kind" IN ('rendition', 'extract', 'unfurl', 'refresh', 'scan'));
ALTER TABLE "resource_jobs" ADD CONSTRAINT "resource_jobs_state_check"
  CHECK ("state" IN ('queued', 'running', 'done', 'failed'));
ALTER TABLE "resources" ADD CONSTRAINT "resources_scan_state_check"
  CHECK ("scan_state" IN ('pending', 'clean', 'blocked', 'skipped'));
