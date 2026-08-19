-- Notifications: one row per line in a person's inbox (lib/notifications).
-- Written by machinery that has something to tell a human — a stored OAuth
-- connection broke, an agent was deactivated or its run failed, a Tool review
-- landed, someone asked for access to a note — and read by the Navbar bell
-- (GET /api/notifications). Delivery beyond the bell (the per-process SSE
-- fan-out) is the service's business; only what happened lives here.
--
-- Additive only: safe to deploy ahead of the code that uses it.

CREATE TABLE "notifications" (
    "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id"     TEXT NOT NULL,
    "space_id"    TEXT,
    "kind"        TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "body"        TEXT,
    "href"        TEXT,
    "dedupe_key"  TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at"     TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- The inbox query: WHERE user_id = ? [AND read_at IS NULL] ORDER BY created_at DESC.
CREATE INDEX "notifications_user_id_read_at_created_at_idx"
  ON "notifications"("user_id", "read_at", "created_at" DESC);

-- A repeat of the same event (same dedupe_key) is dropped while the previous
-- one is still UNREAD — "connection X is broken" fires once, not every tick —
-- and fires again once the person has seen and cleared it. Partial, so rows
-- without a key and already-read rows never collide. Not in schema.prisma
-- (Prisma cannot express a partial unique index); the service relies on the
-- 23505 it raises via INSERT … ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_open_key"
  ON "notifications"("user_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "read_at" IS NULL;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
