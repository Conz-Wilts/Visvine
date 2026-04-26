-- Messaging feature tables

DO $$
BEGIN
  CREATE TYPE "ConversationType" AS ENUM ('DM', 'GROUP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ConversationMemberRole" AS ENUM ('MEMBER', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type "ConversationType" NOT NULL DEFAULT 'DM',
  name TEXT,
  avatar_url TEXT,
  dm_key TEXT UNIQUE,
  created_by_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role "ConversationMemberRole" NOT NULL DEFAULT 'MEMBER',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ,
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_type_idx ON conversations(type);
CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS conversation_members_user_id_idx ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS conversation_members_conversation_id_idx ON conversation_members(conversation_id);
CREATE INDEX IF NOT EXISTS conversation_members_conversation_id_last_read_at_idx ON conversation_members(conversation_id, last_read_at);
CREATE INDEX IF NOT EXISTS messages_conversation_id_created_at_idx ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_sender_id_created_at_idx ON messages(sender_id, created_at);
