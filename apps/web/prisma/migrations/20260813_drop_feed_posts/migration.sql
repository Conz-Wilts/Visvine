-- Drop the standalone social feed. The feed is now a rendering mode of a
-- channel (Conversation.viewMode = 'FEED' -> features/messages/FeedView), which
-- draws Messages, not Posts. The `posts` tables and /api/feed/* routes had no
-- caller left in web or mobile — the /feed page has redirected to /channels for
-- a while. Focus is channels; this is the leftover half of the old surface.
--
-- Children first, though the FKs are ON DELETE CASCADE either way.

DROP TABLE IF EXISTS "post_comment_reactions" CASCADE;
DROP TABLE IF EXISTS "post_reactions" CASCADE;
DROP TABLE IF EXISTS "post_comments" CASCADE;
DROP TABLE IF EXISTS "post_images" CASCADE;
DROP TABLE IF EXISTS "posts" CASCADE;
