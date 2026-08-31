-- The notification system is gone: no bell, no inbox, no per-user fan-out, and
-- nothing left that writes a row. Space invitations go with it — accepting one
-- only ever happened in the bell, and joining a space is now the invite link
-- (`spaces.invite_token`) writing a PENDING `space_members` row that an admin
-- approves.
--
-- DROP TABLE takes the indexes and foreign keys with it.
DROP TABLE IF EXISTS "notifications";
DROP TABLE IF EXISTS "space_invitations";
