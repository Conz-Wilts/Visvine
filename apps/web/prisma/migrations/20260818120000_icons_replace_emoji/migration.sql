-- Icons replace emoji — PHASE 1 of 2: EXPAND (additive, zero-downtime).
--
-- Three columns held emoji as chrome: a channel's icon, a channel section's
-- prefix, and a space's badge. Emoji are not ours and do not render the same on
-- any two platforms (several of the curated set have no glyph at all on
-- Windows), so chrome now names an icon we own — see assets/icons/ and
-- docs/icons.md. `message_reactions.emoji` is deliberately untouched: reactions
-- are user content, not chrome.
--
-- WHY THIS IS SPLIT IN TWO. The obvious migration renames
-- `channel_sections.emoji` and drops `spaces.emoji` — and running that against a
-- live database breaks the currently-deployed image the moment it lands, because
-- that code still does `select { emoji: true }`. Deploys here migrate BEFORE the
-- new image is serving, so there is no ordering of a single migration that
-- avoids the gap.
--
-- So this phase only ADDS. It is safe to apply to a running production database
-- with the OLD code serving: the old column stays exactly where it is, the new
-- one appears beside it, and both readers work. Phase 2 (the drops) is
-- `prisma/manual/20260818140000_icons_drop_emoji_columns.sql`, run BY HAND once
-- the new image is live. See prisma/manual/README.md.
--
-- Every statement is idempotent, so this can be re-run without harm — including
-- against a database that already went through the original one-shot version.

-- 1. channel_sections gains `icon` beside `emoji`.
--
-- Added rather than renamed: a rename is invisible to the old code, which would
-- start erroring on a column that no longer exists. The two live side by side
-- until phase 2.
ALTER TABLE "channel_sections" ADD COLUMN IF NOT EXISTS "icon" TEXT;

-- 2. Backfill `icon` from the emoji that were actually reachable.
--
-- The old picker offered a curated grid of 32 plus a free-form "any emoji"
-- field. The 32 map onto their nearest owned glyph; anything else (a free-form
-- pick, or one of the two the demo scripts set) stays NULL, which is exactly the
-- state the UI already handles — a section simply shows no icon.
--
-- Guarded on the old column still existing, so this is a no-op on a database
-- where phase 2 has already run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'channel_sections' AND column_name = 'emoji'
  ) THEN
    EXECUTE $sql$
      UPDATE "channel_sections" s
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
       WHERE s."emoji" = m.emoji AND s."icon" IS NULL
    $sql$;
  END IF;
END $$;

-- 3. Clear the emoji out of every space's node-type config.
--
-- `node_types[].icon` held an emoji from the column default onward but no
-- surface ever rendered it — the directory draws node types by colour and shape
-- (features/directory/components/typeStyles.ts). Safe in phase 1 precisely
-- because nothing reads it, old code included. Stripping the key rather than
-- translating it makes the JSON match the type again.
UPDATE "spaces"
   SET "node_types" = (
     SELECT jsonb_agg(entry - 'icon' ORDER BY ord)
       FROM jsonb_array_elements("node_types"::jsonb) WITH ORDINALITY AS t(entry, ord)
   )::json
 WHERE "node_types" IS NOT NULL
   AND jsonb_typeof("node_types"::jsonb) = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements("node_types"::jsonb) e WHERE e ? 'icon'
   );

ALTER TABLE "spaces"
  ALTER COLUMN "node_types"
  SET DEFAULT '[{"name": "Person", "color": "#2563eb", "shape": "rectangle"}, {"name": "Space", "color": "#78d870", "shape": "square"}, {"name": "Event", "color": "#ef4444", "shape": "rectangle"}]';

-- NOTE: `spaces.emoji` and `conversations.icon` are deliberately NOT touched
-- here. Dropping the first would break the running image; rewriting the second's
-- CONTENT from emoji to icon names would make the old UI print the literal text
-- "message-circle" in its channel list. Both are phase 2's job, where the new
-- code is already live and degrades gracefully (an unrecognised icon name simply
-- falls back to the default hash glyph).
