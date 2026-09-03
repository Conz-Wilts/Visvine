-- Schema audit: columns nothing reads, indexes another index already covers,
-- constraints wider than the vocabulary, and sidecar rows whose tables exist.

-- Columns written and never read, or never written at all.
ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified", DROP COLUMN IF EXISTS "oauth_provider";
ALTER TABLE "oauth_auth_codes" DROP COLUMN IF EXISTS "resource";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "dm_key";
ALTER TABLE "conversation_members" DROP COLUMN IF EXISTS "muted_until";
ALTER TABLE "agent_vms" DROP COLUMN IF EXISTS "image_digest";
-- A download URL is signed per read from gcs_path; this held one that expired.
ALTER TABLE "resources" DROP COLUMN IF EXISTS "file_url";

-- Each of these is the leading prefix of a unique or wider index on the same
-- table, so Postgres already answers the query from that one.
DROP INDEX IF EXISTS "nodes_space_id_idx";
DROP INDEX IF EXISTS "links_space_id_idx";
DROP INDEX IF EXISTS "event_attendees_event_id_idx";
DROP INDEX IF EXISTS "space_members_user_id_idx";
DROP INDEX IF EXISTS "conversation_members_conversation_id_idx";
DROP INDEX IF EXISTS "context_grants_space_id_subject_type_subject_id_idx";
DROP INDEX IF EXISTS "context_folders_space_id_owner_key_idx";
DROP INDEX IF EXISTS "resource_comments_resource_id_idx";
DROP INDEX IF EXISTS "resource_changes_resource_id_idx";

-- Grant levels are view (10) and edit (30). The retired 20 and 40 have no rows.
ALTER TABLE "context_grants" DROP CONSTRAINT IF EXISTS "context_grants_level_check";
ALTER TABLE "context_grants" ADD CONSTRAINT "context_grants_level_check"
  CHECK ("level" IN (10, 30));
ALTER TABLE "context_access_requests" DROP CONSTRAINT IF EXISTS "context_access_requests_granted_level_check";
ALTER TABLE "context_access_requests" ADD CONSTRAINT "context_access_requests_granted_level_check"
  CHECK ("granted_level" IS NULL OR "granted_level" IN (10, 30));
ALTER TABLE "context_access_requests" DROP CONSTRAINT IF EXISTS "context_access_requests_level_check";
ALTER TABLE "context_access_requests" ADD CONSTRAINT "context_access_requests_level_check"
  CHECK ("level" IN (10, 30));

-- The attendee vocabulary is closed: 'registered' was read as 'going' and no
-- row holds it.
ALTER TABLE "event_attendees" DROP CONSTRAINT IF EXISTS "event_attendees_status_check";
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_status_check"
  CHECK ("status" IN ('invited', 'pending', 'going', 'waitlisted', 'cancelled', 'checked_in', 'no_show'));

-- Sidecar files that became tables: the audit log (context_audit_entries),
-- join requests (context_access_requests) and move proposals
-- (context_move_proposals). Nothing reads these rows any more.
DELETE FROM "context_state"
  WHERE "name" IN ('audit.jsonl', 'join-requests.jsonl', 'move-proposals.jsonl', 'enrichment-state.json');
