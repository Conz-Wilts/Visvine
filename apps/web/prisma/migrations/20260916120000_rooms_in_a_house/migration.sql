-- Rooms in a house (docs/sub-spaces.md): every sub-space answers four
-- questions on its own — who can see it (listing), who may walk in (two
-- doors), what crosses the wall (three upward flows), and who holds its
-- keys (parent_admins, already there). The house answers one: what it
-- shares down and what it hides from its own band (subspace_config).

-- Listing: 'secret' | 'house' | 'world'. `visibility` stays the column every
-- gate reads (world = public, anything else = private); listing only adds the
-- secret/house distinction inside private, and is derived for a top-level
-- space (lib/spaces/subspaces.ts#listingOf). Existing rows keep their meaning:
-- public → world, a private sub-space → house (its parent's members could
-- already see its door), a private top-level space → secret.
ALTER TABLE "spaces" ADD COLUMN "listing" TEXT NOT NULL DEFAULT 'house';
UPDATE "spaces" SET "listing" = CASE
  WHEN "visibility" = 'public' THEN 'world'
  WHEN "parent_id" IS NULL THEN 'secret'
  ELSE 'house' END;

-- Two doors, each 'invite' | 'ask' | 'open'. The house door is for the
-- parent's members; the world door for everyone else, and never wider than
-- the house door. join_policy was the house door with two of the three
-- values: 'parent' meant open, 'request' meant ask. A public room let the
-- parent's members in like anyone, so it starts open.
ALTER TABLE "spaces" ADD COLUMN "house_door" TEXT NOT NULL DEFAULT 'ask';
ALTER TABLE "spaces" ADD COLUMN "world_door" TEXT NOT NULL DEFAULT 'open';
UPDATE "spaces" SET "house_door" = CASE
  WHEN "join_policy" = 'parent' OR "visibility" = 'public' THEN 'open'
  ELSE 'ask' END;
ALTER TABLE "spaces" DROP COLUMN "join_policy";

-- What flows up, each the room's own switch. New rooms default to context
-- and events on, people off; rooms that exist today keep what they did —
-- nothing flowed from a private one, so a private room starts with all off.
ALTER TABLE "spaces" ADD COLUMN "flow_context" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "spaces" ADD COLUMN "flow_events" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "spaces" ADD COLUMN "flow_people" BOOLEAN NOT NULL DEFAULT false;
UPDATE "spaces" SET "flow_context" = false, "flow_events" = false
  WHERE "parent_id" IS NOT NULL AND "visibility" <> 'public';

-- The house's side: { modelKeys: 'all' | [room ids], hiddenFromBand: [room ids] }.
-- Sharing of connectors, agents and Tools is per note (`share:`), not here.
ALTER TABLE "spaces" ADD COLUMN "subspace_config" JSONB NOT NULL DEFAULT '{}';
