-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DM', 'GROUP', 'CHANNEL');

-- CreateEnum
CREATE TYPE "ConversationMemberRole" AS ENUM ('MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ChannelViewMode" AS ENUM ('CHAT', 'FEED');

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "image_url" TEXT,
    "node_types" JSONB DEFAULT '[{"icon": "👤", "name": "Person", "color": "#2563eb", "shape": "rectangle"}, {"icon": "🏘️", "name": "Space", "color": "#78d870", "shape": "square"}, {"icon": "📅", "name": "Event", "color": "#ef4444", "shape": "rectangle"}]',
    "emoji" TEXT,
    "aliases" JSONB DEFAULT '[{"name": "Owner", "color": "#b4881b", "owner": true, "system": true, "nodeType": "Person"}]',
    "link_types" JSONB DEFAULT '[{"name": "Related", "color": "#94a3b8", "directed": false}, {"name": "Knows", "color": "#2563eb", "directed": false}, {"name": "Works at", "color": "#9333ea", "directed": true}, {"name": "Founded", "color": "#16a34a", "directed": true}, {"name": "Invested in", "color": "#f59e0b", "directed": true}, {"name": "Member of", "color": "#0ea5e9", "directed": true}, {"name": "Partner", "color": "#ec4899", "directed": false}, {"name": "Mentors", "color": "#14b8a6", "directed": true}, {"name": "Attended", "color": "#ef4444", "directed": true, "system": true}, {"name": "Hosting", "color": "#ef4444", "directed": true, "system": true}, {"name": "Introduced", "color": "#06b6d4", "directed": false, "system": true}, {"name": "Mentioned", "color": "#8b5cf6", "directed": false, "system": true}]',
    "country" TEXT,
    "design_config" JSONB NOT NULL DEFAULT '{}',
    "feature_config" JSONB NOT NULL DEFAULT '{}',
    "personal_owner_id" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "invite_token" TEXT,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_notes" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_path" TEXT,

    CONSTRAINT "context_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_note_revisions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "note_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editor" TEXT NOT NULL,
    "editor_email" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'edit',
    "model" TEXT,
    "content" TEXT NOT NULL,

    CONSTRAINT "context_note_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_folders" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_state" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_secrets" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_aliases" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alias_name" TEXT NOT NULL,
    "added_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_grants" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL DEFAULT '',
    "resource_path" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL,
    "granted_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_access_requests" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resource_path" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL DEFAULT 10,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "granted_level" INTEGER,

    CONSTRAINT "context_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_publications" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "source_space_id" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "target_space_id" TEXT NOT NULL,
    "target_path" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_note_embeddings" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mtime" BIGINT NOT NULL,
    "embedding" vector(768),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_note_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_sources" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "gcs_path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "text_chars" INTEGER,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_source_chunks" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "source_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT,
    "embedding" vector(768),

    CONSTRAINT "context_source_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "location" TEXT,
    "url" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "image_url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "space_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "alias" TEXT,
    "identity_id" TEXT,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "links" (
    "id" SERIAL NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "since" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "space_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "origin_ref" TEXT,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pair_key" TEXT NOT NULL,

    CONSTRAINT "links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_attendees" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "person_id" TEXT,
    "name" TEXT,
    "email" TEXT,
    "linkedin_url" TEXT,
    "company_name" TEXT,
    "role_title" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'going',
    "response" TEXT,
    "plus_ones" INTEGER NOT NULL DEFAULT 0,
    "plus_one_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invited_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "checkin_at" TIMESTAMP(3),

    CONSTRAINT "event_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "claim_nonce" TEXT,
    "google_id" TEXT,
    "password_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "oauth_provider" TEXT,
    "public_meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_members" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by" TEXT,
    "private_meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "space_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "bio" TEXT,
    "location" TEXT,
    "website" TEXT,
    "linkedin_url" TEXT,
    "twitter_url" TEXT,
    "phone" TEXT,
    "pronouns" TEXT,
    "image_url" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identities" (
    "kind" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "image_url" TEXT,
    "email" TEXT,
    "linkedin_handle" TEXT,
    "website_domain" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_resolutions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "node_id" TEXT NOT NULL,
    "identity_id" TEXT,
    "decision" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER,
    "uploaded_by" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_comments" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "resource_id" TEXT NOT NULL,
    "cell_ref" TEXT,
    "author" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_changes" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "resource_id" TEXT NOT NULL,
    "cell_ref" TEXT NOT NULL,
    "original_value" TEXT,
    "proposed_value" TEXT NOT NULL,
    "reason" TEXT,
    "proposed_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT,
    "redirect_uris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_auth_codes" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "code" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL DEFAULT 'S256',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_refresh_tokens" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "token_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "type" "ConversationType" NOT NULL DEFAULT 'DM',
    "name" TEXT,
    "description" TEXT,
    "avatar_url" TEXT,
    "icon" TEXT,
    "view_mode" "ChannelViewMode" NOT NULL DEFAULT 'CHAT',
    "dm_key" TEXT,
    "space_id" TEXT,
    "section_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_sections" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ConversationMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(3),
    "muted_until" TIMESTAMP(3),

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attachment_url" TEXT,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "reply_to_id" TEXT,
    "pinned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_images" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "message_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_mentions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "message_id" TEXT NOT NULL,
    "mentioned_user_id" TEXT,
    "mentioned_node_id" TEXT,
    "mention_type" TEXT NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_stars" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_stars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_previews" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "image_url" TEXT,
    "site_name" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_link_previews" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "message_id" TEXT NOT NULL,
    "link_preview_id" TEXT NOT NULL,

    CONSTRAINT "message_link_previews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spaces_invite_token_key" ON "spaces"("invite_token");

-- CreateIndex
CREATE INDEX "spaces_personal_owner_id_idx" ON "spaces"("personal_owner_id");

-- CreateIndex
CREATE INDEX "context_notes_space_id_owner_key_deleted_at_idx" ON "context_notes"("space_id", "owner_key", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "context_notes_space_id_owner_key_path_key" ON "context_notes"("space_id", "owner_key", "path");

-- CreateIndex
CREATE INDEX "context_note_revisions_note_id_at_idx" ON "context_note_revisions"("note_id", "at");

-- CreateIndex
CREATE INDEX "context_folders_space_id_owner_key_idx" ON "context_folders"("space_id", "owner_key");

-- CreateIndex
CREATE UNIQUE INDEX "context_folders_space_id_owner_key_path_key" ON "context_folders"("space_id", "owner_key", "path");

-- CreateIndex
CREATE UNIQUE INDEX "context_state_space_id_owner_key_name_key" ON "context_state"("space_id", "owner_key", "name");

-- CreateIndex
CREATE UNIQUE INDEX "connector_secrets_space_id_name_key" ON "connector_secrets"("space_id", "name");

-- CreateIndex
CREATE INDEX "user_aliases_user_id_idx" ON "user_aliases"("user_id");

-- CreateIndex
CREATE INDEX "user_aliases_space_id_alias_name_idx" ON "user_aliases"("space_id", "alias_name");

-- CreateIndex
CREATE UNIQUE INDEX "user_aliases_space_id_user_id_alias_name_key" ON "user_aliases"("space_id", "user_id", "alias_name");

-- CreateIndex
CREATE INDEX "context_grants_space_id_subject_type_subject_id_idx" ON "context_grants"("space_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "context_grants_space_id_subject_type_subject_id_resource_pa_key" ON "context_grants"("space_id", "subject_type", "subject_id", "resource_path");

-- CreateIndex
CREATE INDEX "context_access_requests_space_id_status_idx" ON "context_access_requests"("space_id", "status");

-- CreateIndex
CREATE INDEX "context_access_requests_user_id_idx" ON "context_access_requests"("user_id");

-- CreateIndex
CREATE INDEX "context_publications_source_space_id_source_path_idx" ON "context_publications"("source_space_id", "source_path");

-- CreateIndex
CREATE INDEX "context_publications_target_space_id_target_path_idx" ON "context_publications"("target_space_id", "target_path");

-- CreateIndex
CREATE UNIQUE INDEX "context_publications_source_space_id_source_path_target_spa_key" ON "context_publications"("source_space_id", "source_path", "target_space_id");

-- CreateIndex
CREATE UNIQUE INDEX "context_note_embeddings_space_id_owner_key_path_key" ON "context_note_embeddings"("space_id", "owner_key", "path");

-- CreateIndex
CREATE INDEX "context_sources_space_id_owner_key_status_idx" ON "context_sources"("space_id", "owner_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "context_sources_space_id_owner_key_path_key" ON "context_sources"("space_id", "owner_key", "path");

-- CreateIndex
CREATE INDEX "context_source_chunks_space_id_owner_key_model_idx" ON "context_source_chunks"("space_id", "owner_key", "model");

-- CreateIndex
CREATE UNIQUE INDEX "context_source_chunks_source_id_seq_key" ON "context_source_chunks"("source_id", "seq");

-- CreateIndex
CREATE INDEX "nodes_space_id_idx" ON "nodes"("space_id");

-- CreateIndex
CREATE INDEX "nodes_type_idx" ON "nodes"("type");

-- CreateIndex
CREATE INDEX "nodes_space_id_type_idx" ON "nodes"("space_id", "type");

-- CreateIndex
CREATE INDEX "nodes_identity_id_idx" ON "nodes"("identity_id");

-- CreateIndex
CREATE INDEX "links_source_id_idx" ON "links"("source_id");

-- CreateIndex
CREATE INDEX "links_target_id_idx" ON "links"("target_id");

-- CreateIndex
CREATE INDEX "links_space_id_idx" ON "links"("space_id");

-- CreateIndex
CREATE INDEX "links_pair_key_idx" ON "links"("pair_key");

-- CreateIndex
CREATE UNIQUE INDEX "links_space_id_pair_key_relationship_key" ON "links"("space_id", "pair_key", "relationship");

-- CreateIndex
CREATE INDEX "event_attendees_event_id_idx" ON "event_attendees"("event_id");

-- CreateIndex
CREATE INDEX "event_attendees_event_id_status_idx" ON "event_attendees"("event_id", "status");

-- CreateIndex
CREATE INDEX "event_attendees_person_id_idx" ON "event_attendees"("person_id");

-- CreateIndex
CREATE INDEX "event_attendees_email_idx" ON "event_attendees"("email");

-- CreateIndex
CREATE UNIQUE INDEX "event_attendees_event_id_email_key" ON "event_attendees"("event_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_claim_nonce_key" ON "users"("claim_nonce");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "space_members_user_id_idx" ON "space_members"("user_id");

-- CreateIndex
CREATE INDEX "space_members_space_id_idx" ON "space_members"("space_id");

-- CreateIndex
CREATE UNIQUE INDEX "space_members_user_id_space_id_key" ON "space_members"("user_id", "space_id");

-- CreateIndex
CREATE UNIQUE INDEX "people_user_id_key" ON "people"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "identities_user_id_key" ON "identities"("user_id");

-- CreateIndex
CREATE INDEX "identities_kind_email_idx" ON "identities"("kind", "email");

-- CreateIndex
CREATE INDEX "identities_kind_linkedin_handle_idx" ON "identities"("kind", "linkedin_handle");

-- CreateIndex
CREATE INDEX "identities_kind_website_domain_idx" ON "identities"("kind", "website_domain");

-- CreateIndex
CREATE INDEX "identities_kind_name_key_idx" ON "identities"("kind", "name_key");

-- CreateIndex
CREATE INDEX "identity_resolutions_node_id_idx" ON "identity_resolutions"("node_id");

-- CreateIndex
CREATE INDEX "identity_resolutions_identity_id_idx" ON "identity_resolutions"("identity_id");

-- CreateIndex
CREATE INDEX "identity_resolutions_decision_idx" ON "identity_resolutions"("decision");

-- CreateIndex
CREATE INDEX "resources_space_id_idx" ON "resources"("space_id");

-- CreateIndex
CREATE INDEX "resource_comments_resource_id_idx" ON "resource_comments"("resource_id");

-- CreateIndex
CREATE INDEX "resource_comments_resource_id_cell_ref_idx" ON "resource_comments"("resource_id", "cell_ref");

-- CreateIndex
CREATE INDEX "resource_changes_resource_id_idx" ON "resource_changes"("resource_id");

-- CreateIndex
CREATE INDEX "resource_changes_resource_id_status_idx" ON "resource_changes"("resource_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "oauth_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_auth_codes_code_key" ON "oauth_auth_codes"("code");

-- CreateIndex
CREATE INDEX "oauth_auth_codes_expires_at_idx" ON "oauth_auth_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_refresh_tokens_token_hash_key" ON "oauth_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_refresh_tokens_user_id_idx" ON "oauth_refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_dm_key_key" ON "conversations"("dm_key");

-- CreateIndex
CREATE INDEX "conversations_type_idx" ON "conversations"("type");

-- CreateIndex
CREATE INDEX "conversations_updated_at_idx" ON "conversations"("updated_at");

-- CreateIndex
CREATE INDEX "conversations_space_id_type_idx" ON "conversations"("space_id", "type");

-- CreateIndex
CREATE INDEX "conversations_section_id_idx" ON "conversations"("section_id");

-- CreateIndex
CREATE INDEX "channel_sections_space_id_position_idx" ON "channel_sections"("space_id", "position");

-- CreateIndex
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members"("user_id");

-- CreateIndex
CREATE INDEX "conversation_members_conversation_id_idx" ON "conversation_members"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_members_conversation_id_last_read_at_idx" ON "conversation_members"("conversation_id", "last_read_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_members_conversation_id_user_id_key" ON "conversation_members"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_pinned_at_idx" ON "messages"("conversation_id", "pinned_at");

-- CreateIndex
CREATE INDEX "message_images_message_id_idx" ON "message_images"("message_id");

-- CreateIndex
CREATE INDEX "message_mentions_message_id_idx" ON "message_mentions"("message_id");

-- CreateIndex
CREATE INDEX "message_mentions_mentioned_user_id_idx" ON "message_mentions"("mentioned_user_id");

-- CreateIndex
CREATE INDEX "message_mentions_mentioned_node_id_idx" ON "message_mentions"("mentioned_node_id");

-- CreateIndex
CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_message_id_user_id_emoji_key" ON "message_reactions"("message_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "message_stars_user_id_created_at_idx" ON "message_stars"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_stars_message_id_user_id_key" ON "message_stars"("message_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_previews_url_key" ON "link_previews"("url");

-- CreateIndex
CREATE INDEX "message_link_previews_message_id_idx" ON "message_link_previews"("message_id");

-- AddForeignKey
ALTER TABLE "context_notes" ADD CONSTRAINT "context_notes_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_note_revisions" ADD CONSTRAINT "context_note_revisions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "context_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_folders" ADD CONSTRAINT "context_folders_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_state" ADD CONSTRAINT "context_state_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_secrets" ADD CONSTRAINT "connector_secrets_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_aliases" ADD CONSTRAINT "user_aliases_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_grants" ADD CONSTRAINT "context_grants_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_access_requests" ADD CONSTRAINT "context_access_requests_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_publications" ADD CONSTRAINT "context_publications_source_space_id_fkey" FOREIGN KEY ("source_space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_publications" ADD CONSTRAINT "context_publications_target_space_id_fkey" FOREIGN KEY ("target_space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_note_embeddings" ADD CONSTRAINT "context_note_embeddings_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_sources" ADD CONSTRAINT "context_sources_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_source_chunks" ADD CONSTRAINT "context_source_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "context_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links" ADD CONSTRAINT "links_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links" ADD CONSTRAINT "links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links" ADD CONSTRAINT "links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_comments" ADD CONSTRAINT "resource_comments_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_changes" ADD CONSTRAINT "resource_changes_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "channel_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_sections" ADD CONSTRAINT "channel_sections_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_images" ADD CONSTRAINT "message_images_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_stars" ADD CONSTRAINT "message_stars_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_stars" ADD CONSTRAINT "message_stars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_link_previews" ADD CONSTRAINT "message_link_previews_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_link_previews" ADD CONSTRAINT "message_link_previews_link_preview_id_fkey" FOREIGN KEY ("link_preview_id") REFERENCES "link_previews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

