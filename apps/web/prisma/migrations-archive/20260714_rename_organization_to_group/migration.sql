-- Rename the "Organization" node type to "Group" across all stored data.
-- The identity `kind` column ('person' | 'organization') is internal plumbing and
-- is intentionally left untouched — only the user-facing node type is renamed.

-- 1. Existing directory nodes: any organization-flavoured type -> canonical 'Group'.
UPDATE "nodes"
SET "type" = 'Group'
WHERE lower("type") IN ('organization', 'organisation', 'org');

-- 2. Per-community node-type config: rename the base type name in the node_types array.
UPDATE "communities"
SET "node_types" = (
  SELECT jsonb_agg(
    CASE
      WHEN lower(elem->>'name') IN ('organization', 'organisation')
        THEN jsonb_set(elem, '{name}', '"Group"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements("node_types"::jsonb) AS elem
)
WHERE "node_types" IS NOT NULL
  AND jsonb_typeof("node_types"::jsonb) = 'array'
  AND jsonb_array_length("node_types"::jsonb) > 0;

-- 3. Community aliases are scoped to a base node type via `nodeType`. Re-point any
--    aliases that were scoped to Organization so they stay attached to Group.
UPDATE "communities"
SET "community_aliases" = (
  SELECT jsonb_agg(
    CASE
      WHEN lower(elem->>'nodeType') IN ('organization', 'organisation')
        THEN jsonb_set(elem, '{nodeType}', '"Group"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements("community_aliases"::jsonb) AS elem
)
WHERE "community_aliases" IS NOT NULL
  AND jsonb_typeof("community_aliases"::jsonb) = 'array'
  AND jsonb_array_length("community_aliases"::jsonb) > 0;

-- 4. Update the column default so newly-created communities seed "Group".
ALTER TABLE "communities"
  ALTER COLUMN "node_types"
  SET DEFAULT '[{"icon": "👤", "name": "Person", "color": "#2563eb", "shape": "rectangle"}, {"icon": "👥", "name": "Group", "color": "#9333ea", "shape": "hexagon"}, {"icon": "📅", "name": "Event", "color": "#ef4444", "shape": "rectangle"}]';
