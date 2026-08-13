-- Free the word "space" for the tenant itself.
--
-- ChannelSpace was the named grouping of a community's channels in the rail —
-- a section, and already called one in the node-type vocabulary ('section')
-- and half the code comments. With the tenant renamed Community -> Space, one
-- word cannot mean both, so the container takes the name it already had
-- everywhere else.
--
--   channel_spaces         -> channel_sections
--   conversations.space_id -> conversations.section_id
--
-- Indexes and constraints are renamed alongside so they keep matching what
-- Prisma generates for the new names.

ALTER TABLE channel_spaces RENAME TO channel_sections;
ALTER INDEX channel_spaces_pkey RENAME TO channel_sections_pkey;
ALTER INDEX channel_spaces_community_id_position_idx RENAME TO channel_sections_community_id_position_idx;
ALTER TABLE channel_sections RENAME CONSTRAINT channel_spaces_community_id_fkey TO channel_sections_community_id_fkey;

ALTER TABLE conversations RENAME COLUMN space_id TO section_id;
ALTER INDEX conversations_space_id_idx RENAME TO conversations_section_id_idx;
ALTER TABLE conversations RENAME CONSTRAINT conversations_space_id_fkey TO conversations_section_id_fkey;

-- The structural node that mirrors a section carries the record id in its
-- metadata (lib/notes/context/entityNodes.ts RECORD_KEY).
UPDATE nodes
   SET metadata = (metadata - 'spaceId') || jsonb_build_object('sectionId', metadata->'spaceId')
 WHERE metadata ? 'spaceId';
