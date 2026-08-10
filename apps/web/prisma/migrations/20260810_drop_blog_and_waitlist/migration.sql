-- Drop the blog and the waitlist. Both features are gone from the app: the
-- marketing landing page's CTA has been real sign-up ("Join our community")
-- for a while, which left the waitlist endpoint with no caller at all, and the
-- blog is no longer wanted.
--
-- Children first, though CASCADE would handle the FKs either way.

DROP TABLE IF EXISTS "blog_comment_reactions" CASCADE;
DROP TABLE IF EXISTS "blog_comments" CASCADE;
DROP TABLE IF EXISTS "blog_posts" CASCADE;
DROP TABLE IF EXISTS "waitlist_entries" CASCADE;
