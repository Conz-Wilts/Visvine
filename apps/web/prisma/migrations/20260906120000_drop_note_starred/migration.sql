-- Context notes have no starred state. There is no Starred section in the tree,
-- no star in the editor's toolbar and no endpoint that sets one, so the column
-- is an index of a flag nothing reads and nothing writes.
--
-- The flag's source of truth was the note's own frontmatter, so removing the
-- feature means removing that line too: a note left carrying `starred: true`
-- would keep declaring a state the app no longer has, and the frontmatter is
-- read by agents and shown in Raw. Only a whole `starred:` line at the start of
-- a line inside a leading frontmatter block is touched; body text is not.
UPDATE "context_notes"
SET "content" = regexp_replace("content", '(?n)^starred[ \t]*:.*\r?\n', '', 'g')
WHERE "content" ~ '(?n)^starred[ \t]*:';

UPDATE "context_note_revisions"
SET "content" = regexp_replace("content", '(?n)^starred[ \t]*:.*\r?\n', '', 'g')
WHERE "content" ~ '(?n)^starred[ \t]*:';

ALTER TABLE "context_notes" DROP COLUMN IF EXISTS "starred";
