-- Two settings a SUB-space's own admins choose about the space it sits inside
-- (docs/sub-spaces.md, "What crosses the boundary"). Both default to the
-- closed answer, so nothing changes for a sub-space that never sets them.

-- Who may walk into a PRIVATE sub-space without asking. 'request' = the door
-- as before: a member of the parent sees the locked row and lands `pending`
-- until an admin answers. 'parent' = an active member of the parent joins
-- straight away; everyone else is still refused. Meaningless on a public
-- space (anyone may join) and on a top-level one (there is no parent).
ALTER TABLE "spaces" ADD COLUMN "join_policy" TEXT NOT NULL DEFAULT 'request';

-- Whether the parent's admins administer this sub-space too. Off, a
-- sub-space's admins are exactly the holders of its own admin aliases; on,
-- lib/auth.ts#isAdmin also answers yes for anyone who administers the parent.
-- Set by the sub-space's own admin, never by the parent's — the room decides
-- who holds its keys.
ALTER TABLE "spaces" ADD COLUMN "parent_admins" BOOLEAN NOT NULL DEFAULT false;
