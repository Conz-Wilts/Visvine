-- CRM Layer: Private & Community Columns
-- Run in Supabase SQL Editor with service role

-- Private column definitions (per user, per community)
CREATE TABLE IF NOT EXISTS private_columns (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  column_key   TEXT NOT NULL,
  column_name  TEXT NOT NULL,
  column_type  TEXT NOT NULL DEFAULT 'text',
  options      JSONB,
  position     INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, community_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_private_columns_user_community ON private_columns(user_id, community_id);

-- Private column values
CREATE TABLE IF NOT EXISTS private_column_values (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  column_id  TEXT NOT NULL REFERENCES private_columns(id) ON DELETE CASCADE,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, node_id, column_id)
);

CREATE INDEX IF NOT EXISTS idx_private_column_values_user_node ON private_column_values(user_id, node_id);
CREATE INDEX IF NOT EXISTS idx_private_column_values_column ON private_column_values(column_id);

-- Community column requests (users submit, admins approve)
CREATE TABLE IF NOT EXISTS community_column_requests (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  community_id  TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  requester_id  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  column_key    TEXT NOT NULL,
  column_name   TEXT NOT NULL,
  column_type   TEXT NOT NULL DEFAULT 'text',
  options       JSONB,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id   TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  reviewer_note TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ccr_community_status ON community_column_requests(community_id, status);
CREATE INDEX IF NOT EXISTS idx_ccr_requester ON community_column_requests(requester_id);

-- Approved community columns
CREATE TABLE IF NOT EXISTS community_columns (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  community_id            TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  column_key              TEXT NOT NULL,
  column_name             TEXT NOT NULL,
  column_type             TEXT NOT NULL DEFAULT 'text',
  options                 JSONB,
  position                INTEGER DEFAULT 0,
  created_from_request_id TEXT UNIQUE REFERENCES community_column_requests(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE(community_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_community_columns_community ON community_columns(community_id);

-- Values for community columns (any member can contribute)
CREATE TABLE IF NOT EXISTS community_column_values (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  community_id     TEXT NOT NULL,
  node_id          TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  column_key       TEXT NOT NULL,
  column_id        TEXT NOT NULL REFERENCES community_columns(id) ON DELETE CASCADE,
  value            TEXT,
  contributed_by_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(community_id, node_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_ccv_community_node ON community_column_values(community_id, node_id);
CREATE INDEX IF NOT EXISTS idx_ccv_column ON community_column_values(column_id);
