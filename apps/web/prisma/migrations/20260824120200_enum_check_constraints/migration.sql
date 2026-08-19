-- Make invalid states unrepresentable.
--
-- Two dozen columns in this schema are enums in everything but enforcement:
-- status, kind, origin, index_state, decision, subject_type, visibility, mode,
-- trigger, level. Every valid value was documented in a line comment and checked
-- nowhere, so a typo in a service wrote a row that Postgres accepted and every
-- reader silently mishandled. That is the worst shape a bug can take here: it
-- commits, it is durable, and it surfaces later as a UI that renders nothing or
-- a projection that skips a row.
--
-- The comments were also drifting, which is the second reason to do this. FOUR
-- were already wrong when this migration was written. context_sources.kind said
-- "csv | markdown | text (extension point: pdf | xlsx)" while the code had long
-- since shipped json, docx and spreadsheet; agent_runs.trigger said
-- "scheduled | manual" while RunTrigger had five members; and
-- identity_resolutions.decision omitted 'created' entirely, which is what 624 of
-- the rows in the development database actually hold. A comment cannot go stale
-- silently once the database agrees with it: adding a value now means touching
-- this file, in the same commit as the code that emits it. (A fifth was caught
-- by the coverage guard before this migration shipped: agent_state
-- .deactivated_reason omitted 'config'. Four is the count of comments that were
-- wrong; the guard is what makes the fifth the last one found by accident.)
--
-- WHY EVERY CONSTRAINT IS "NOT VALID", AND WHY THAT IS NOT A WEAKER FIX.
--
-- NOT VALID means Postgres enforces the constraint on every INSERT and UPDATE
-- from this moment on, but does not scan the existing table to prove old rows
-- comply. That is exactly the trade we want:
--
--   * The whole benefit -- no new row can hold an invalid value -- lands in
--     full, immediately.
--   * The whole risk -- a legacy row from before a rename, a seed script, or a
--     hand-edit failing the check and ABORTING THE MIGRATION -- is removed.
--     deploy.yml runs migrations against production BEFORE it builds the image,
--     so a migration that fails on unexpected data does not merely stop; it
--     leaves production half-migrated with the old image still serving.
--   * The check on old rows is not skipped, only moved somewhere it can fail
--     safely: "pnpm db:constraints:validate" runs VALIDATE CONSTRAINT on each
--     one and prints the offending rows. Run it after deploying; fix what it
--     finds; run it again. A validated constraint is recorded as validated, so
--     the command is idempotent and cheap to re-run.
--
-- The sets below come from the TypeScript unions that are the real source of
-- truth (NoteRevisionOrigin, LinkOrigin, SourceKind, RunStatus, RunTrigger,
-- ResourceChangeStatus, the LEVEL_* constants), not from the schema comments --
-- which is why two of them are wider here than the comment beside the column.

-- ── notes: the declaration tier ─────────────────────────────────────────────

ALTER TABLE "spaces" ADD CONSTRAINT "spaces_visibility_check"
  CHECK ("visibility" IN ('public', 'private')) NOT VALID;

-- NoteRevisionOrigin. 'publish' is on this list and was missing from the column
-- comment: a replica write records a revision like any other save.
ALTER TABLE "context_note_revisions" ADD CONSTRAINT "context_note_revisions_origin_check"
  CHECK ("origin" IN ('edit', 'ai-refactor', 'ai-enrich', 'agent', 'maintenance', 'restore', 'baseline', 'publish')) NOT VALID;

ALTER TABLE "note_projection_jobs" ADD CONSTRAINT "note_projection_jobs_kind_check"
  CHECK ("kind" IN ('write', 'rename', 'delete')) NOT VALID;

ALTER TABLE "note_projection_jobs" ADD CONSTRAINT "note_projection_jobs_origin_check"
  CHECK ("origin" IN ('edit', 'ai-refactor', 'ai-enrich', 'agent', 'maintenance', 'restore', 'baseline', 'publish')) NOT VALID;

-- ── access ──────────────────────────────────────────────────────────────────

ALTER TABLE "context_grants" ADD CONSTRAINT "context_grants_subject_type_check"
  CHECK ("subject_type" IN ('space', 'alias', 'user')) NOT VALID;

-- LEVEL_VIEW 10, LEVEL_COMMENT 20, LEVEL_EDIT 30, LEVEL_FULL 40. A level between
-- the rungs would compare as "more than view, less than edit" in winningGrant
-- and silently grant something nobody named.
ALTER TABLE "context_grants" ADD CONSTRAINT "context_grants_level_check"
  CHECK ("level" IN (10, 20, 30, 40)) NOT VALID;

ALTER TABLE "context_access_requests" ADD CONSTRAINT "context_access_requests_status_check"
  CHECK ("status" IN ('pending', 'approved', 'denied')) NOT VALID;

ALTER TABLE "context_access_requests" ADD CONSTRAINT "context_access_requests_granted_level_check"
  CHECK ("granted_level" IS NULL OR "granted_level" IN (10, 20, 30, 40)) NOT VALID;

ALTER TABLE "context_move_proposals" ADD CONSTRAINT "context_move_proposals_kind_check"
  CHECK ("kind" IN ('copy', 'publish')) NOT VALID;

ALTER TABLE "context_move_proposals" ADD CONSTRAINT "context_move_proposals_status_check"
  CHECK ("status" IN ('pending', 'approved', 'denied')) NOT VALID;

ALTER TABLE "space_members" ADD CONSTRAINT "space_members_status_check"
  CHECK ("status" IN ('active', 'pending')) NOT VALID;

-- ── sources and the Drive ───────────────────────────────────────────────────

ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_status_check"
  CHECK ("status" IN ('pending', 'ready', 'failed')) NOT VALID;

-- SourceKind. The column comment claimed three values and an extension point;
-- the dispatch table in lib/notes/shared/sourceTypes.ts has had six for a while.
ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_kind_check"
  CHECK ("kind" IN ('csv', 'markdown', 'text', 'json', 'docx', 'spreadsheet')) NOT VALID;

ALTER TABLE "resources" ADD CONSTRAINT "resources_index_state_check"
  CHECK ("index_state" IN ('pending', 'indexed', 'unsupported', 'failed')) NOT VALID;

ALTER TABLE "resource_changes" ADD CONSTRAINT "resource_changes_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected')) NOT VALID;

-- ── agents ──────────────────────────────────────────────────────────────────

ALTER TABLE "agent_state" ADD CONSTRAINT "agent_state_status_check"
  CHECK ("status" IN ('idle', 'running')) NOT VALID;

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_check"
  CHECK ("status" IN ('running', 'succeeded', 'failed')) NOT VALID;

-- RunTrigger. The column comment said "scheduled | manual"; three more have
-- shipped since (an event mailbox wake, a verified webhook, an interval run).
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_trigger_check"
  CHECK ("trigger" IN ('scheduled', 'manual', 'event', 'webhook', 'interval')) NOT VALID;

ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_kind_check"
  CHECK ("kind" IN ('note_written', 'webhook', 'reply')) NOT VALID;

-- The FOURTH stale comment, found by the coverage guard in
-- tests/schema-constraints.test.ts rather than by reading: the column comment
-- omits 'config', which lib/agents/hooks.ts writes when a live note's
-- configuration stops being valid. Nullable, because an ACTIVE agent has no
-- deactivation reason -- which is itself worth encoding, since a row carrying
-- both `active` and a reason would be a contradiction nothing else would catch.
ALTER TABLE "agent_state" ADD CONSTRAINT "agent_state_deactivated_reason_check"
  CHECK ("deactivated_reason" IS NULL OR "deactivated_reason" IN
    ('brief_changed', 'key_rejected', 'repeated_failure', 'author_gone', 'renamed', 'deleted', 'admin', 'config')) NOT VALID;

-- ── graph and identity ──────────────────────────────────────────────────────

-- LinkOrigin. origin is what makes an auto-created edge symmetrically undoable,
-- so an unrecognised one is an edge nothing can ever clean up.
ALTER TABLE "links" ADD CONSTRAINT "links_origin_check"
  CHECK ("origin" IN ('manual', 'event_attendance', 'event_hosting', 'intro', 'context', 'structure', 'import')) NOT VALID;

-- 'registered' is a LEGACY value, normalised to 'going' on read by
-- eventUtils.normalizeStatus. It is on the list because old rows still hold it
-- and the constraint describes what the column may contain, not what new code
-- should write.
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_status_check"
  CHECK ("status" IN ('going', 'waitlisted', 'pending', 'checked_in', 'no_show', 'cancelled', 'invited', 'registered')) NOT VALID;

ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_response_check"
  CHECK ("response" IS NULL OR "response" IN ('going', 'maybe', 'declined')) NOT VALID;

ALTER TABLE "identities" ADD CONSTRAINT "identities_kind_check"
  CHECK ("kind" IN ('person', 'organization')) NOT VALID;

-- The third stale comment, and the one the validator caught rather than the
-- reading did: the column comment listed only the REVIEW decisions and omitted
-- 'created', which is what the resolver writes every time no candidate clears
-- the bar -- 624 of the rows in this database. It is on the `Decision` union in
-- lib/identity/match.ts and always was. This is exactly why the constraints go
-- in NOT VALID and are validated separately: had this migration validated
-- inline, it would have aborted on real, correct data.
ALTER TABLE "identity_resolutions" ADD CONSTRAINT "identity_resolutions_decision_check"
  CHECK ("decision" IN ('auto_strong', 'auto_name_company', 'suggested', 'created', 'confirmed', 'rejected', 'split', 'merged')) NOT VALID;

-- ── tools and connectors ────────────────────────────────────────────────────

ALTER TABLE "app_tool_versions" ADD CONSTRAINT "app_tool_versions_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn')) NOT VALID;

-- 'user' = one member's account, 'space' = the space's shared connection. This
-- one decides whether an agent run may use the connection at all, so a third
-- value would be a quiet authorization question rather than a display bug.
ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_mode_check"
  CHECK ("mode" IN ('user', 'space')) NOT VALID;
