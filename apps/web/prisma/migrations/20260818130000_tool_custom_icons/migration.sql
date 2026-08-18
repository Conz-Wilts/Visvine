-- Tools may ship their own rail icon.
--
-- A Tool used to pick from a closed set of ten built-in shapes, because the
-- sidebar is app chrome and there was no safe way to accept an author's SVG.
-- There is one now: lib/tools/iconSvg.ts sanitizes the author's `icon.svg` at
-- BUILD time, and these two columns hold the result.
--
-- What goes in them is already sanitized. That is the contract the rail relies
-- on — it renders this value directly, and nothing downstream re-parses author
-- markup. A row written by anything other than the build pipeline breaks that
-- assumption, so don't.

-- The author's working copy.
ALTER TABLE "app_tool_builds" ADD COLUMN "icon_svg" TEXT;

-- The immutable published snapshot, so an install carries the icon it was
-- reviewed with rather than re-reading the author's (possibly since-edited,
-- possibly deleted) note.
ALTER TABLE "app_tool_versions" ADD COLUMN "icon_svg" TEXT;
