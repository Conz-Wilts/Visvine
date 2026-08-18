-- Icons replace emoji — PHASE 2 of 2: CONTRACT (destructive, run by hand).
--
-- Prerequisite: the image that stopped reading these columns is LIVE. Phase 1
-- (prisma/migrations/20260818120000_icons_replace_emoji) is additive and can run
-- ahead of a deploy; this cannot. Running it while the old image is still
-- serving 500s `/api/profile/[personId]/communities`,
-- `/api/communities/[spaceId]/overview` and channel serialization.
--
-- Not a prisma migration on purpose. `prisma migrate deploy` applies everything
-- pending in one go, and the deploy pipeline migrates BEFORE the new image is
-- serving — so as a migration this would run inside exactly the window it has to
-- avoid. It lives here until someone runs it deliberately.
--
-- ONE-WAY. There is no reverse mapping from an icon name back to the emoji
-- somebody originally picked. Take a backup first:
--
--   gcloud sql backups create --instance=visvine-pgdata
--
-- Then, from apps/web with DATABASE_URL pointed at the target:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual/20260818140000_icons_drop_emoji_columns.sql
--
-- Idempotent — safe to re-run, and a no-op on a database that already has it.

BEGIN;

-- 1. Convert a channel's icon from an emoji to an owned icon name.
--
-- Deferred to phase 2 because this column is not renamed, only re-interpreted:
-- the OLD UI renders whatever is in it as a character, so converting early would
-- print the literal text "message-circle" in the channel rail. The new UI
-- handles the reverse gracefully — an unrecognised name falls back to the
-- default hash glyph — so the brief window before this runs costs nothing.
UPDATE "conversations" c
   SET "icon" = m.icon
  FROM (VALUES
    ('💬','message-circle'), ('📣','megaphone'),  ('📌','pin'),       ('🎯','target'),
    ('🚀','rocket'),         ('💡','lightbulb'),  ('🔥','flame'),     ('⭐','star'),
    ('🎉','party-popper'),   ('🤝','handshake'),  ('🧠','brain'),     ('📚','book-open'),
    ('📈','trending-up'),    ('💼','briefcase'),  ('🛠️','hammer'),    ('🎨','palette'),
    ('🌱','sprout'),         ('☕','coffee'),     ('🍕','pizza'),     ('🎮','gamepad-2'),
    ('🏆','trophy'),         ('❤️','heart'),      ('👋','hand'),      ('🔔','bell'),
    ('🗳️','vote'),           ('🧭','compass'),    ('🌍','earth'),     ('🎵','music'),
    ('📷','camera'),         ('🏡','house'),      ('💰','coins'),     ('🤖','bot')
  ) AS m(emoji, icon)
 WHERE c."icon" = m.emoji;

-- Anything the grid never offered (a free-form emoji) has no owned equivalent.
-- NULL is the state the UI already handles: the channel shows the default hash.
UPDATE "conversations"
   SET "icon" = NULL
 WHERE "icon" IS NOT NULL
   AND "icon" !~ '^[a-z0-9]+(-[a-z0-9]+)*$';

-- Same for any section row phase 1's backfill could not map.
UPDATE "channel_sections"
   SET "icon" = NULL
 WHERE "icon" IS NOT NULL
   AND "icon" !~ '^[a-z0-9]+(-[a-z0-9]+)*$';

-- 2. Drop the columns nothing reads any more.
--
-- `channel_sections.emoji` was superseded by `icon` in phase 1.
ALTER TABLE "channel_sections" DROP COLUMN IF EXISTS "emoji";

-- `spaces.emoji` is dropped outright rather than replaced. It rendered as a
-- badge with an initials fallback, and the fallback is the better default:
-- initials are legible everywhere, always fit the circle, and a space that wants
-- a real mark already has `image_url`.
ALTER TABLE "spaces" DROP COLUMN IF EXISTS "emoji";

COMMIT;

-- After this runs, `prisma migrate diff` should report no drift against
-- schema.prisma. If you would rather have it in prisma's history, create an
-- empty migration and paste this in:
--
--   pnpm dlx prisma@7.4.0 migrate dev --create-only --name icons_drop_emoji_columns
