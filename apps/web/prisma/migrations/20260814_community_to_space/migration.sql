-- Community is a Space. The 2026-08 vocabulary rename reaches the schema.
--
-- Eight tables and every foreign key that pointed at them still said
-- 'community'; the product has called them spaces since the redesign. Model
-- names, physical names, indexes and constraints all move together so the
-- generated names keep matching what Prisma expects and drift checks stay
-- quiet. Route paths (/api/communities/*), note folders (communities/<slug>.md)
-- and node id prefixes (community:<slug>) are deliberately NOT touched: the
-- first is the mobile wire contract, the other two are link identity.

-- Tables
ALTER TABLE "community_note_revisions" RENAME TO space_note_revisions;
ALTER TABLE "community_note_embeddings" RENAME TO space_note_embeddings;
ALTER TABLE "community_note_folders" RENAME TO space_note_folders;
ALTER TABLE "community_brain_files" RENAME TO space_brain_files;
ALTER TABLE "community_secrets" RENAME TO space_secrets;
ALTER TABLE "community_notes" RENAME TO space_notes;
ALTER TABLE "user_communities" RENAME TO space_members;
ALTER TABLE "communities" RENAME TO spaces;

-- Columns
ALTER TABLE brain_access_requests RENAME COLUMN community_id TO space_id;
ALTER TABLE brain_grants RENAME COLUMN community_id TO space_id;
ALTER TABLE channel_sections RENAME COLUMN community_id TO space_id;
ALTER TABLE spaces RENAME COLUMN community_aliases TO aliases;
ALTER TABLE space_brain_files RENAME COLUMN community_id TO space_id;
ALTER TABLE space_note_embeddings RENAME COLUMN community_id TO space_id;
ALTER TABLE space_note_folders RENAME COLUMN community_id TO space_id;
ALTER TABLE space_notes RENAME COLUMN community_id TO space_id;
ALTER TABLE space_secrets RENAME COLUMN community_id TO space_id;
ALTER TABLE context_source_chunks RENAME COLUMN community_id TO space_id;
ALTER TABLE context_sources RENAME COLUMN community_id TO space_id;
ALTER TABLE conversations RENAME COLUMN community_id TO space_id;
ALTER TABLE links RENAME COLUMN community_id TO space_id;
ALTER TABLE nodes RENAME COLUMN community_id TO space_id;
ALTER TABLE note_publications RENAME COLUMN source_community_id TO source_space_id;
ALTER TABLE note_publications RENAME COLUMN target_community_id TO target_space_id;
ALTER TABLE resources RENAME COLUMN community_id TO space_id;
ALTER TABLE user_aliases RENAME COLUMN community_id TO space_id;
ALTER TABLE space_members RENAME COLUMN community_id TO space_id;

-- Indexes (non-constraint)
ALTER INDEX brain_access_requests_community_id_status_idx RENAME TO brain_access_requests_space_id_status_idx;
ALTER INDEX brain_grants_community_id_subject_type_subject_id_idx RENAME TO brain_grants_space_id_subject_type_subject_id_idx;
ALTER INDEX brain_grants_community_id_subject_type_subject_id_resource__key RENAME TO brain_grants_space_id_subject_type_subject_id_resource__key;
ALTER INDEX channel_sections_community_id_position_idx RENAME TO channel_sections_space_id_position_idx;
ALTER INDEX communities_invite_token_key RENAME TO spaces_invite_token_key;
ALTER INDEX communities_personal_owner_id_idx RENAME TO spaces_personal_owner_id_idx;
ALTER INDEX community_brain_files_community_id_owner_key_name_key RENAME TO space_brain_files_space_id_owner_key_name_key;
ALTER INDEX community_note_embeddings_community_id_owner_key_path_key RENAME TO space_note_embeddings_space_id_owner_key_path_key;
ALTER INDEX community_note_folders_community_id_owner_key_idx RENAME TO space_note_folders_space_id_owner_key_idx;
ALTER INDEX community_note_folders_community_id_owner_key_path_key RENAME TO space_note_folders_space_id_owner_key_path_key;
ALTER INDEX community_note_revisions_note_id_at_idx RENAME TO space_note_revisions_note_id_at_idx;
ALTER INDEX community_notes_community_id_owner_key_deleted_at_idx RENAME TO space_notes_space_id_owner_key_deleted_at_idx;
ALTER INDEX community_notes_community_id_owner_key_path_key RENAME TO space_notes_space_id_owner_key_path_key;
ALTER INDEX community_secrets_community_id_name_key RENAME TO space_secrets_space_id_name_key;
ALTER INDEX context_source_chunks_community_id_owner_key_model_idx RENAME TO context_source_chunks_space_id_owner_key_model_idx;
ALTER INDEX context_sources_community_id_owner_key_path_key RENAME TO context_sources_space_id_owner_key_path_key;
ALTER INDEX context_sources_community_id_owner_key_status_idx RENAME TO context_sources_space_id_owner_key_status_idx;
ALTER INDEX conversations_community_id_type_idx RENAME TO conversations_space_id_type_idx;
ALTER INDEX links_community_id_idx RENAME TO links_space_id_idx;
ALTER INDEX links_community_id_pair_key_relationship_key RENAME TO links_space_id_pair_key_relationship_key;
ALTER INDEX nodes_community_id_idx RENAME TO nodes_space_id_idx;
ALTER INDEX nodes_community_id_type_idx RENAME TO nodes_space_id_type_idx;
ALTER INDEX note_publications_source_community_id_source_path_idx RENAME TO note_publications_source_space_id_source_path_idx;
ALTER INDEX note_publications_source_community_id_source_path_target_co_key RENAME TO note_publications_source_space_id_source_path_target_co_key;
ALTER INDEX note_publications_target_community_id_target_path_idx RENAME TO note_publications_target_space_id_target_path_idx;
ALTER INDEX resources_community_id_idx RENAME TO resources_space_id_idx;
ALTER INDEX user_aliases_community_id_alias_name_idx RENAME TO user_aliases_space_id_alias_name_idx;
ALTER INDEX user_aliases_community_id_user_id_alias_name_key RENAME TO user_aliases_space_id_user_id_alias_name_key;
ALTER INDEX user_communities_community_id_idx RENAME TO space_members_space_id_idx;
ALTER INDEX user_communities_user_id_community_id_key RENAME TO space_members_user_id_space_id_key;
ALTER INDEX user_communities_user_id_idx RENAME TO space_members_user_id_idx;

-- Constraints (primary keys, uniques, foreign keys)
ALTER TABLE brain_access_requests RENAME CONSTRAINT brain_access_requests_community_id_fkey TO brain_access_requests_space_id_fkey;
ALTER TABLE brain_grants RENAME CONSTRAINT brain_grants_community_id_fkey TO brain_grants_space_id_fkey;
ALTER TABLE channel_sections RENAME CONSTRAINT channel_sections_community_id_fkey TO channel_sections_space_id_fkey;
ALTER TABLE spaces RENAME CONSTRAINT communities_pkey TO spaces_pkey;
ALTER TABLE space_brain_files RENAME CONSTRAINT community_brain_files_community_id_fkey TO space_brain_files_space_id_fkey;
ALTER TABLE space_brain_files RENAME CONSTRAINT community_brain_files_pkey TO space_brain_files_pkey;
ALTER TABLE space_note_embeddings RENAME CONSTRAINT community_note_embeddings_community_id_fkey TO space_note_embeddings_space_id_fkey;
ALTER TABLE space_note_embeddings RENAME CONSTRAINT community_note_embeddings_pkey TO space_note_embeddings_pkey;
ALTER TABLE space_note_folders RENAME CONSTRAINT community_note_folders_community_id_fkey TO space_note_folders_space_id_fkey;
ALTER TABLE space_note_folders RENAME CONSTRAINT community_note_folders_pkey TO space_note_folders_pkey;
ALTER TABLE space_note_revisions RENAME CONSTRAINT community_note_revisions_note_id_fkey TO space_note_revisions_note_id_fkey;
ALTER TABLE space_note_revisions RENAME CONSTRAINT community_note_revisions_pkey TO space_note_revisions_pkey;
ALTER TABLE space_notes RENAME CONSTRAINT community_notes_community_id_fkey TO space_notes_space_id_fkey;
ALTER TABLE space_notes RENAME CONSTRAINT community_notes_pkey TO space_notes_pkey;
ALTER TABLE space_secrets RENAME CONSTRAINT community_secrets_community_id_fkey TO space_secrets_space_id_fkey;
ALTER TABLE space_secrets RENAME CONSTRAINT community_secrets_pkey TO space_secrets_pkey;
ALTER TABLE context_sources RENAME CONSTRAINT context_sources_community_id_fkey TO context_sources_space_id_fkey;
ALTER TABLE conversations RENAME CONSTRAINT conversations_community_id_fkey TO conversations_space_id_fkey;
ALTER TABLE links RENAME CONSTRAINT links_community_id_fkey TO links_space_id_fkey;
ALTER TABLE nodes RENAME CONSTRAINT nodes_community_id_fkey TO nodes_space_id_fkey;
ALTER TABLE note_publications RENAME CONSTRAINT note_publications_source_community_id_fkey TO note_publications_source_space_id_fkey;
ALTER TABLE note_publications RENAME CONSTRAINT note_publications_target_community_id_fkey TO note_publications_target_space_id_fkey;
ALTER TABLE user_aliases RENAME CONSTRAINT user_aliases_community_id_fkey TO user_aliases_space_id_fkey;
ALTER TABLE space_members RENAME CONSTRAINT user_communities_added_by_fkey TO space_members_added_by_fkey;
ALTER TABLE space_members RENAME CONSTRAINT user_communities_community_id_fkey TO space_members_space_id_fkey;
ALTER TABLE space_members RENAME CONSTRAINT user_communities_pkey TO space_members_pkey;
ALTER TABLE space_members RENAME CONSTRAINT user_communities_user_id_fkey TO space_members_user_id_fkey;

-- Two index names had been truncated at 63 chars against the OLD column names;
-- renaming the columns freed enough room for the full generated name, so they
-- are spelled out here rather than left as drift.
ALTER INDEX brain_grants_space_id_subject_type_subject_id_resource__key
  RENAME TO brain_grants_space_id_subject_type_subject_id_resource_path_key;
ALTER INDEX note_publications_source_space_id_source_path_target_co_key
  RENAME TO note_publications_source_space_id_source_path_target_space__key;

-- Pre-existing drift this audit turned up, unrelated to the rename but found
-- by the same diff:
--
--   people.has_onboarded — a boolean left behind by a removed onboarding flow.
--     Not in schema.prisma, not read or written anywhere in web, mobile or the
--     seed. It carried data (4 true / 1 false) and no meaning.
--   spaces.visibility — the column default was 'public' while the schema (and
--     every code path that reasons about it) says 'private'. A space whose
--     visibility nobody set must be hidden, not discoverable.

ALTER TABLE people DROP COLUMN IF EXISTS has_onboarded;
ALTER TABLE spaces ALTER COLUMN visibility SET DEFAULT 'private';

-- Two stored VALUES also spelled the old vocabulary. They are enum-like strings
-- the code compares against, so they move with it rather than being carried as
-- synonyms forever.
--
--   brain_grants.subject_type 'community' — the space-wide grant subject
--                                           ('community' | 'alias' | 'user')
--   nodes.metadata.visibility 'community' — an event visible to the whole space
--                                           ('public' | 'community' | 'private')

UPDATE brain_grants SET subject_type = 'space' WHERE subject_type = 'community';

UPDATE nodes
   SET metadata = jsonb_set(metadata, '{visibility}', '"space"')
 WHERE type = 'event' AND metadata->>'visibility' = 'community';

-- The node metadata key that points a directory card at a real space row.
UPDATE nodes
   SET metadata = (metadata - 'communityRef') || jsonb_build_object('spaceRef', metadata->'communityRef')
 WHERE metadata ? 'communityRef';
