-- A person's profile is their account. `people` was one row per user — every
-- writer set user_id, and the two tables had the same count — so its columns
-- move onto `users` and the row's id, which was the user's own person node,
-- becomes users.node_id.

ALTER TABLE "users"
  ADD COLUMN "node_id" TEXT,
  ADD COLUMN "subtitle" TEXT,
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "linkedin_url" TEXT,
  ADD COLUMN "twitter_url" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "pronouns" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "users_node_id_key" ON "users"("node_id");

-- The profile's own values win over the account's where both were set: the
-- profile editor wrote people.*, while users.name and users.image were only
-- ever refreshed from the sign-in provider.
UPDATE "users" u SET
  "node_id"      = p."id",
  "name"         = COALESCE(NULLIF(btrim(p."name"), ''), u."name"),
  "image"        = COALESCE(p."image_url", u."image"),
  "subtitle"     = p."subtitle",
  "bio"          = p."bio",
  "location"     = p."location",
  "website"      = p."website",
  "linkedin_url" = p."linkedin_url",
  "twitter_url"  = p."twitter_url",
  "phone"        = p."phone",
  "pronouns"     = p."pronouns",
  "tags"         = p."tags",
  "public_meta"  = u."public_meta" || p."metadata"
FROM "people" p
WHERE p."user_id" = u."id";

DROP TABLE "people";

-- Left behind by the space_members rename; nothing in the schema names it.
DROP INDEX IF EXISTS "idx_user_communities_user_id";
