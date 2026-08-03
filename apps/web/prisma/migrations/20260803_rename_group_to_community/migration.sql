-- Rename the user-facing node type "Group" -> "Community" across all stored data.
-- Mirrors 20260714_rename_organization_to_group, which moved Organization -> Group;
-- this is the next hop in that same lineage. The identity `kind` column
-- ('person' | 'organization') stays untouched — it's plumbing, not a label.
--
-- Appearance: an entry still wearing the stock Group look (👥 / #9333ea / hexagon)
-- is re-skinned to the stock Community look (🏘️ / #78d870 / square) to match the
-- new column default. An entry someone customised keeps its icon/colour/shape and
-- only has its name rewritten.

-- 1. Existing directory nodes: any group-flavoured type -> canonical 'Community'.
UPDATE "nodes"
SET "type" = 'Community'
WHERE lower("type") IN ('group', 'groups');

-- 2. Per-community node-type config: rename the base type in the node_types array.
--    A community that already had its own 'Community' type would end up with two
--    entries of the same name, so collapse duplicates by name, keeping the entry
--    that appeared first in the original array.
UPDATE "communities" c
SET "node_types" = sub.arr
FROM (
  SELECT
    c2."id",
    (
      SELECT jsonb_agg(d.elem ORDER BY d.ord)
      FROM (
        SELECT DISTINCT ON (lower(r.elem->>'name')) r.elem, r.ord
        FROM (
          SELECT
            CASE
              WHEN lower(e->>'name') NOT IN ('group', 'groups') THEN e
              WHEN e->>'icon' = '👥'
               AND lower(e->>'color') = '#9333ea'
               AND lower(e->>'shape') = 'hexagon'
                THEN e || '{"icon": "🏘️", "name": "Community", "color": "#78d870", "shape": "square"}'::jsonb
              ELSE e || '{"name": "Community"}'::jsonb
            END AS elem,
            ord
          FROM jsonb_array_elements(c2."node_types"::jsonb) WITH ORDINALITY AS t(e, ord)
        ) r
        ORDER BY lower(r.elem->>'name'), r.ord
      ) d
    ) AS arr
  FROM "communities" c2
  WHERE c2."node_types" IS NOT NULL
    AND jsonb_typeof(c2."node_types"::jsonb) = 'array'
    AND jsonb_array_length(c2."node_types"::jsonb) > 0
) sub
WHERE c."id" = sub."id"
  AND sub.arr IS NOT NULL;

-- 3. Community aliases are scoped to a base node type via `nodeType`. Re-point any
--    aliases scoped to Group so they stay attached to Community.
UPDATE "communities"
SET "community_aliases" = (
  SELECT jsonb_agg(
    CASE
      WHEN lower(elem->>'nodeType') IN ('group', 'groups')
        THEN jsonb_set(elem, '{nodeType}', '"Community"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements("community_aliases"::jsonb) AS elem
)
WHERE "community_aliases" IS NOT NULL
  AND jsonb_typeof("community_aliases"::jsonb) = 'array'
  AND jsonb_array_length("community_aliases"::jsonb) > 0;

-- 4. Update the column default so newly-created communities seed "Community".
ALTER TABLE "communities"
  ALTER COLUMN "node_types"
  SET DEFAULT '[{"icon": "👤", "name": "Person", "color": "#2563eb", "shape": "rectangle"}, {"icon": "🏘️", "name": "Community", "color": "#78d870", "shape": "square"}, {"icon": "📅", "name": "Event", "color": "#ef4444", "shape": "rectangle"}]';
