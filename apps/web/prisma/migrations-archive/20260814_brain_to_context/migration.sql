-- The brain is the Context. Tables are named after the tool that owns them.
--
-- "brain_*" / "space_note_*" were an inherited word for a (space_id, owner_key)
-- note namespace; the product calls that surface Context, and the MCP tools
-- already say list_context / read_context / search_context. The storage now
-- says it too. Two tables move to the tool that actually owns them:
-- space_secrets belongs to Connectors, attendees to Events.
--
-- `nodes` and `links` are deliberately NOT renamed to directory_*: they back
-- Context entity notes and Events as much as the Directory, so they stay the
-- global graph primitives. `owner_key` keeps its name — it is the namespace
-- key, and it stays.
--
-- Constraint and index names move with their tables so Prisma's generated
-- names keep matching and drift checks stay quiet.

-- Tables
ALTER TABLE "space_notes" RENAME TO context_notes;
ALTER TABLE "space_note_revisions" RENAME TO context_note_revisions;
ALTER TABLE "space_note_folders" RENAME TO context_folders;
ALTER TABLE "space_note_embeddings" RENAME TO context_note_embeddings;
ALTER TABLE "space_brain_files" RENAME TO context_state;
ALTER TABLE "brain_grants" RENAME TO context_grants;
ALTER TABLE "brain_access_requests" RENAME TO context_access_requests;
ALTER TABLE "note_publications" RENAME TO context_publications;
ALTER TABLE "space_secrets" RENAME TO connector_secrets;
ALTER TABLE "attendees" RENAME TO event_attendees;

-- Primary keys
ALTER INDEX space_notes_pkey RENAME TO context_notes_pkey;
ALTER INDEX space_note_revisions_pkey RENAME TO context_note_revisions_pkey;
ALTER INDEX space_note_folders_pkey RENAME TO context_folders_pkey;
ALTER INDEX space_note_embeddings_pkey RENAME TO context_note_embeddings_pkey;
ALTER INDEX space_brain_files_pkey RENAME TO context_state_pkey;
ALTER INDEX brain_grants_pkey RENAME TO context_grants_pkey;
ALTER INDEX brain_access_requests_pkey RENAME TO context_access_requests_pkey;
ALTER INDEX note_publications_pkey RENAME TO context_publications_pkey;
ALTER INDEX space_secrets_pkey RENAME TO connector_secrets_pkey;
ALTER INDEX attendees_pkey RENAME TO event_attendees_pkey;

-- Unique constraints
ALTER INDEX space_notes_space_id_owner_key_path_key RENAME TO context_notes_space_id_owner_key_path_key;
ALTER INDEX space_note_folders_space_id_owner_key_path_key RENAME TO context_folders_space_id_owner_key_path_key;
ALTER INDEX space_note_embeddings_space_id_owner_key_path_key RENAME TO context_note_embeddings_space_id_owner_key_path_key;
ALTER INDEX space_brain_files_space_id_owner_key_name_key RENAME TO context_state_space_id_owner_key_name_key;
ALTER INDEX brain_grants_space_id_subject_type_subject_id_resource_path_key RENAME TO context_grants_space_id_subject_type_subject_id_resource_pa_key;
ALTER INDEX note_publications_source_space_id_source_path_target_space__key RENAME TO context_publications_source_space_id_source_path_target_spa_key;
ALTER INDEX space_secrets_space_id_name_key RENAME TO connector_secrets_space_id_name_key;
ALTER INDEX attendees_event_id_email_key RENAME TO event_attendees_event_id_email_key;

-- Indexes
ALTER INDEX space_notes_space_id_owner_key_deleted_at_idx RENAME TO context_notes_space_id_owner_key_deleted_at_idx;
ALTER INDEX space_note_revisions_note_id_at_idx RENAME TO context_note_revisions_note_id_at_idx;
ALTER INDEX space_note_folders_space_id_owner_key_idx RENAME TO context_folders_space_id_owner_key_idx;
ALTER INDEX brain_grants_space_id_subject_type_subject_id_idx RENAME TO context_grants_space_id_subject_type_subject_id_idx;
ALTER INDEX brain_access_requests_space_id_status_idx RENAME TO context_access_requests_space_id_status_idx;
ALTER INDEX brain_access_requests_user_id_idx RENAME TO context_access_requests_user_id_idx;
ALTER INDEX note_publications_source_space_id_source_path_idx RENAME TO context_publications_source_space_id_source_path_idx;
ALTER INDEX note_publications_target_space_id_target_path_idx RENAME TO context_publications_target_space_id_target_path_idx;
ALTER INDEX attendees_event_id_idx RENAME TO event_attendees_event_id_idx;
ALTER INDEX attendees_event_id_status_idx RENAME TO event_attendees_event_id_status_idx;
ALTER INDEX attendees_person_id_idx RENAME TO event_attendees_person_id_idx;
ALTER INDEX attendees_email_idx RENAME TO event_attendees_email_idx;

-- Foreign keys
ALTER TABLE context_notes RENAME CONSTRAINT space_notes_space_id_fkey TO context_notes_space_id_fkey;
ALTER TABLE context_note_revisions RENAME CONSTRAINT space_note_revisions_note_id_fkey TO context_note_revisions_note_id_fkey;
ALTER TABLE context_folders RENAME CONSTRAINT space_note_folders_space_id_fkey TO context_folders_space_id_fkey;
ALTER TABLE context_note_embeddings RENAME CONSTRAINT space_note_embeddings_space_id_fkey TO context_note_embeddings_space_id_fkey;
ALTER TABLE context_state RENAME CONSTRAINT space_brain_files_space_id_fkey TO context_state_space_id_fkey;
ALTER TABLE context_grants RENAME CONSTRAINT brain_grants_space_id_fkey TO context_grants_space_id_fkey;
ALTER TABLE context_access_requests RENAME CONSTRAINT brain_access_requests_space_id_fkey TO context_access_requests_space_id_fkey;
ALTER TABLE context_publications RENAME CONSTRAINT note_publications_source_space_id_fkey TO context_publications_source_space_id_fkey;
ALTER TABLE context_publications RENAME CONSTRAINT note_publications_target_space_id_fkey TO context_publications_target_space_id_fkey;
ALTER TABLE connector_secrets RENAME CONSTRAINT space_secrets_space_id_fkey TO connector_secrets_space_id_fkey;
ALTER TABLE event_attendees RENAME CONSTRAINT attendees_event_id_fkey TO event_attendees_event_id_fkey;
ALTER TABLE event_attendees RENAME CONSTRAINT attendees_person_id_fkey TO event_attendees_person_id_fkey;
