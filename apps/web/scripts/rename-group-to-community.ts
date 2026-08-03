/**
 * One-off migration: rename the user-facing node type "Group" -> "Community".
 *
 * The next hop after rename-organization-to-group.ts, and rewrites the same four
 * places in place:
 *   1. nodes.type                    — any group-flavoured value -> 'Community'
 *   2. communities.node_types        — the base type name in the per-community config
 *   3. communities.community_aliases — re-points aliases scoped to Group
 *   4. communities.node_types DEFAULT — so new communities seed 'Community'
 *
 * An entry still wearing the stock Group look (👥 / #9333ea / hexagon) is re-skinned
 * to the stock Community look (🏘️ / #78d870 / square); a customised entry keeps its
 * icon/colour/shape and only has its name rewritten. Where renaming would collide
 * with a 'Community' type the community already had, the duplicate is collapsed and
 * the entry that came first in the array wins.
 *
 * The internal identity `kind` column ('person' | 'organization') is deliberately
 * left untouched — it's plumbing, not a user-facing label.
 *
 * Idempotent: re-running is a no-op once every row is already 'Community'.
 * Not guarded to local-only — a rename must also run against prod. Point
 * DATABASE_URL / DIRECT_DATABASE_URL at the target DB before running.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/rename-group-to-community.ts            # apply
 *   pnpm --filter @visvine/web exec tsx scripts/rename-group-to-community.ts --dry-run  # report only
 */

import 'dotenv/config';
import prisma from '../lib/prisma';

const dryRun = process.argv.includes('--dry-run');

const NEW_DEFAULT =
  '[{"icon": "👤", "name": "Person", "color": "#2563eb", "shape": "rectangle"}, {"icon": "🏘️", "name": "Community", "color": "#78d870", "shape": "square"}, {"icon": "📅", "name": "Event", "color": "#ef4444", "shape": "rectangle"}]';

async function main() {
  if (dryRun) {
    const [{ count: nodeCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "nodes" WHERE lower("type") IN ('group','groups')`,
    );
    const [{ count: commCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "communities"
         WHERE "node_types"::text ILIKE '%"name": %roup%'
            OR "community_aliases"::text ILIKE '%"nodeType": %roup%'`,
    );
    console.log(`[dry-run] nodes to rename:        ${nodeCount}`);
    console.log(`[dry-run] communities to rewrite: ${commCount}`);
    return;
  }

  const nodes = await prisma.$executeRawUnsafe(
    `UPDATE "nodes" SET "type" = 'Community'
       WHERE lower("type") IN ('group','groups')`,
  );
  console.log(`nodes renamed -> Community: ${nodes}`);

  const nodeTypes = await prisma.$executeRawUnsafe(
    `UPDATE "communities" c
       SET "node_types" = sub.arr
       FROM (
         SELECT c2."id",
           (
             SELECT jsonb_agg(d.elem ORDER BY d.ord)
             FROM (
               SELECT DISTINCT ON (lower(r.elem->>'name')) r.elem, r.ord
               FROM (
                 SELECT
                   CASE
                     WHEN lower(e->>'name') NOT IN ('group','groups') THEN e
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
         AND sub.arr IS NOT NULL`,
  );
  console.log(`communities.node_types rewritten: ${nodeTypes}`);

  const aliases = await prisma.$executeRawUnsafe(
    `UPDATE "communities"
       SET "community_aliases" = (
         SELECT jsonb_agg(
           CASE WHEN lower(elem->>'nodeType') IN ('group','groups')
                THEN jsonb_set(elem, '{nodeType}', '"Community"')
                ELSE elem END
         )
         FROM jsonb_array_elements("community_aliases"::jsonb) AS elem
       )
       WHERE "community_aliases" IS NOT NULL
         AND jsonb_typeof("community_aliases"::jsonb) = 'array'
         AND jsonb_array_length("community_aliases"::jsonb) > 0`,
  );
  console.log(`communities.community_aliases rewritten: ${aliases}`);

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "communities"
       ALTER COLUMN "node_types"
       SET DEFAULT '${NEW_DEFAULT}'`,
  );
  console.log('communities.node_types default updated -> Community');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
