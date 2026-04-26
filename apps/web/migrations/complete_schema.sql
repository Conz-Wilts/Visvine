-- ============================================
-- Complete Database Schema for Visvine
-- PostgreSQL Local Setup
-- ============================================

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 1. Communities Table
-- ============================================
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  description TEXT,
  location TEXT,
  tags TEXT[] DEFAULT '{}',
  member_count INTEGER DEFAULT 0,
  data_file TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  image_url TEXT,
  node_types JSONB DEFAULT '[
    {"name":"Person","color":"#2563eb","shape":"rectangle","icon":"👤"},
    {"name":"Organization","color":"#9333ea","shape":"hexagon","icon":"🏢"},
    {"name":"Event","color":"#ef4444","shape":"rectangle","icon":"📅"},
    {"name":"Group","color":"#0ea5e9","shape":"rectangle","icon":"👥"}
  ]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_communities_id ON communities(id);

-- ============================================
-- 2. Nodes Table (People, Orgs, Events, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  subtitle TEXT,
  location TEXT,
  url TEXT,
  tags TEXT[] DEFAULT '{}',
  image_url TEXT,
  metadata JSONB DEFAULT '{}',
  community_id TEXT REFERENCES communities(id) ON DELETE CASCADE,
  embedding vector(1536), -- OpenAI text-embedding-3-small
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nodes_id ON nodes(id);
CREATE INDEX IF NOT EXISTS idx_nodes_community_id ON nodes(community_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_embedding ON nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- 3. Links Table (Relationships between nodes)
-- ============================================
CREATE TABLE IF NOT EXISTS links (
  id SERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  since TEXT,
  metadata JSONB DEFAULT '{}',
  community_id TEXT REFERENCES communities(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_links_source_id ON links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target_id ON links(target_id);
CREATE INDEX IF NOT EXISTS idx_links_community_id ON links(community_id);

-- ============================================
-- 4. Attendees Table (Event RSVPs)
-- ============================================
CREATE TABLE IF NOT EXISTS attendees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  email TEXT,
  linkedin_url TEXT,
  company_name TEXT,
  role_title TEXT,
  answers JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'registered',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  checkin_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_attendees_event_id ON attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_attendees_person_id ON attendees(person_id);
CREATE INDEX IF NOT EXISTS idx_attendees_email ON attendees(email);

-- ============================================
-- 5. Better Auth Tables
-- ============================================

-- User table
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  image TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_email ON "user"(email);

-- Session table
CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_user_id ON "session"(user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON "session"(token);
CREATE INDEX IF NOT EXISTS idx_session_expires_at ON "session"(expires_at);

-- Account table (for OAuth providers)
CREATE TABLE IF NOT EXISTS "account" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  access_token_expires_at TIMESTAMP WITH TIME ZONE,
  refresh_token_expires_at TIMESTAMP WITH TIME ZONE,
  scope TEXT,
  id_token TEXT,
  password TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_user_id ON "account"(user_id);
CREATE INDEX IF NOT EXISTS idx_account_provider_id ON "account"(provider_id);

-- Verification table
CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification"(identifier);
CREATE INDEX IF NOT EXISTS idx_verification_expires_at ON "verification"(expires_at);

-- User-Community relationship table
CREATE TABLE IF NOT EXISTS "user_communities" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES "communities"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, community_id)
);

CREATE INDEX IF NOT EXISTS idx_user_communities_user_id ON "user_communities"(user_id);
CREATE INDEX IF NOT EXISTS idx_user_communities_community_id ON "user_communities"(community_id);

-- ============================================
-- 6. Functions and Triggers
-- ============================================

-- Update trigger for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at
CREATE TRIGGER update_nodes_updated_at BEFORE UPDATE ON nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendees_updated_at BEFORE UPDATE ON attendees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_updated_at BEFORE UPDATE ON "session"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_account_updated_at BEFORE UPDATE ON "account"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_verification_updated_at BEFORE UPDATE ON "verification"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. RPC Function for Semantic Search
-- ============================================
CREATE OR REPLACE FUNCTION match_nodes(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_community_id text
)
RETURNS TABLE (
  id text,
  type text,
  name text,
  subtitle text,
  location text,
  url text,
  tags text[],
  image_url text,
  metadata jsonb,
  community_id text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    nodes.id,
    nodes.type,
    nodes.name,
    nodes.subtitle,
    nodes.location,
    nodes.url,
    nodes.tags,
    nodes.image_url,
    nodes.metadata,
    nodes.community_id,
    1 - (nodes.embedding <=> query_embedding) as similarity
  FROM nodes
  WHERE nodes.community_id = filter_community_id
    AND nodes.embedding IS NOT NULL
    AND 1 - (nodes.embedding <=> query_embedding) > match_threshold
  ORDER BY nodes.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================
-- Summary
-- ============================================
-- Tables created:
-- - communities: Network communities
-- - nodes: All entities (people, orgs, events)
-- - links: Relationships between nodes
-- - attendees: Event RSVP tracking
-- - user: User accounts (Better Auth)
-- - session: Active sessions (Better Auth)
-- - account: OAuth accounts (Better Auth)
-- - verification: Email verification (Better Auth)
-- - user_communities: User-community memberships
-- ============================================
