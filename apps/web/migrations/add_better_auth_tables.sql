-- ============================================
-- Better Auth Database Schema for PostgreSQL
-- ============================================
-- Run this in Supabase SQL Editor with elevated privileges

-- 1. Create User Table
-- ============================================
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  image TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_user_email ON "user"(email);

-- 2. Create Session Table
-- ============================================
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_user_id ON "session"(user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON "session"(token);
CREATE INDEX IF NOT EXISTS idx_session_expires_at ON "session"(expires_at);

-- 3. Create Account Table (for OAuth providers)
-- ============================================
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_account_user_id ON "account"(user_id);
CREATE INDEX IF NOT EXISTS idx_account_provider_id ON "account"(provider_id);

-- 4. Create Verification Table
-- ============================================
CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index for verification lookups
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification"(identifier);
CREATE INDEX IF NOT EXISTS idx_verification_expires_at ON "verification"(expires_at);

-- 5. Create User-Community Relationship Table (NEW)
-- ============================================
-- This links authenticated users to communities they've joined
CREATE TABLE IF NOT EXISTS "user_communities" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES "communities"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member'
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, community_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_communities_user_id ON "user_communities"(user_id);
CREATE INDEX IF NOT EXISTS idx_user_communities_community_id ON "user_communities"(community_id);

-- 6. Update trigger for updated_at columns
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables
CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_updated_at BEFORE UPDATE ON "session"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_account_updated_at BEFORE UPDATE ON "account"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_verification_updated_at BEFORE UPDATE ON "verification"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Summary
-- ============================================
-- Tables created:
-- - user: Core user accounts
-- - session: Active user sessions
-- - account: OAuth provider accounts (Google, etc.)
-- - verification: Email verification codes
-- - user_communities: User-to-community membership (NEW)
-- ============================================
