-- Being added to a space is now something the person agrees to.
--
-- An admin's "invite by email" used to write an active space_members row on the
-- spot: you found out you had joined somebody's space by noticing it in your
-- sidebar. It now writes a row here instead, and the invitee answers it from
-- their notification bell. Accepting is what creates the membership.
--
-- Why a table of its own rather than a third space_members.status: most
-- membership checks in the codebase read whether the row EXISTS, not what its
-- status says. An unanswered invitation sitting in space_members would be
-- access handed over before the answer — exactly the thing this removes.
CREATE TABLE IF NOT EXISTS "space_invitations" (
  "id"           TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "space_id"     TEXT NOT NULL REFERENCES "spaces" ("id") ON DELETE CASCADE,
  "user_id"      TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "invited_by"   TEXT REFERENCES "users" ("id") ON DELETE SET NULL,
  "alias_ids"    TEXT[] NOT NULL DEFAULT '{}',
  "status"       TEXT NOT NULL DEFAULT 'pending',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at" TIMESTAMP(3)
);

-- One live invitation per person per space; a re-invite after a decline
-- overwrites the answered row rather than stacking a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "space_invitations_space_id_user_id_key"
  ON "space_invitations" ("space_id", "user_id");

-- The invitee's own list (the bell), and the admin's pending queue.
CREATE INDEX IF NOT EXISTS "space_invitations_user_id_status_idx"
  ON "space_invitations" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "space_invitations_space_id_status_idx"
  ON "space_invitations" ("space_id", "status");
