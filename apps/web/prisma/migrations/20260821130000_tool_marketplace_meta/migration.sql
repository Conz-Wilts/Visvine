-- Tool marketplace metadata (lib/tools/registry.ts, plan ticket 4.1).
--
-- Three more snapshot columns on a published Tool version. Like every other
-- column on this table apart from the review trio, they are written once at
-- publish and never updated — an install pins the version, and what a browser
-- read on the card is what the author shipped.
--
--   release_notes  the author's own "what changed" text, passed to publish
--                  (`publish_tool { release_notes }` / the publish dialog).
--                  Distinct from review_note, which is the reviewer's verdict.
--   tags           `tags: [..]` from tools/<name>/index.md at publish time
--                  (≤8, each ^[a-z0-9-]{1,24}$ — lib/tools/config.ts).
--   preview_url    `preview:` from the same frontmatter — a same-origin
--                  /api/media/... path or an https URL, validated at parse.
--
-- Additive only: nullable / defaulted, so every existing row reads as
-- "no notes, no tags, no preview" and the deploy is safe ahead of the code.
ALTER TABLE "app_tool_versions" ADD COLUMN "release_notes" TEXT;
ALTER TABLE "app_tool_versions" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "app_tool_versions" ADD COLUMN "preview_url" TEXT;
