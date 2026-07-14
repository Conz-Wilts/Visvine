/**
 * One-off migration: rename the user-facing node type "Organization" -> "Group".
 *
 * Rewrites, in place:
 *   1. nodes.type                    — any organization-flavoured value -> 'Group'
 *   2. communities.node_types        — the base type name in the per-community config
 *   3. communities.community_aliases — re-points aliases scoped to Organization
 *   4. communities.node_types DEFAULT — so new communities seed 'Group'
 *
 * The internal identity `kind` column ('person' | 'organization') is deliberately
 * left untouched — it's plumbing, not a user-facing label.
 *
 * Idempotent: re-running is a no-op once every row is already 'Group'.
 * Not guarded to local-only — a rename must also run against prod. Point
 * DATABASE_URL / DIRECT_DATABASE_URL at the target DB before running.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/rename-organization-to-group.ts            # apply
 *   pnpm --filter @visvine/web exec tsx scripts/rename-organization-to-group.ts --dry-run  # report only
 */

import 'dotenv/config';
import prisma from '../lib/prisma';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (dryRun) {
    const [{ count: nodeCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "nodes" WHERE lower("type") IN ('organization','organisation','org')`,
    );
    const [{ count: commCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "communities"
         WHERE "node_types"::text ILIKE '%"name": %rgani%ation%'
            OR "community_aliases"::text ILIKE '%"nodeType": %rgani%ation%'`,
    );
    console.log(`[dry-run] nodes to rename:        ${nodeCount}`);
    console.log(`[dry-run] communities to rewrite: ${commCount}`);
    return;
  }

  const nodes = await prisma.$executeRawUnsafe(
    `UPDATE "nodes" SET "type" = 'Group'
       WHERE lower("type") IN ('organization','organisation','org')`,
  );
  console.log(`nodes renamed -> Group: ${nodes}`);

  const nodeTypes = await prisma.$executeRawUnsafe(
    `UPDATE "communities"
       SET "node_types" = (
         SELECT jsonb_agg(
           CASE WHEN lower(elem->>'name') IN ('organization','organisation')
                THEN jsonb_set(elem, '{name}', '"Group"')
                ELSE elem END
         )
         FROM jsonb_array_elements("node_types"::jsonb) AS elem
       )
       WHERE "node_types" IS NOT NULL
         AND jsonb_typeof("node_types"::jsonb) = 'array'
         AND jsonb_array_length("node_types"::jsonb) > 0`,
  );
  console.log(`communities.node_types rewritten: ${nodeTypes}`);

  const aliases = await prisma.$executeRawUnsafe(
    `UPDATE "communities"
       SET "community_aliases" = (
         SELECT jsonb_agg(
           CASE WHEN lower(elem->>'nodeType') IN ('organization','organisation')
                THEN jsonb_set(elem, '{nodeType}', '"Group"')
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
       SET DEFAULT '[{"icon": "👤", "name": "Person", "color": "#2563eb", "shape": "rectangle"}, {"icon": "👥", "name": "Group", "color": "#9333ea", "shape": "hexagon"}, {"icon": "📅", "name": "Event", "color": "#ef4444", "shape": "rectangle"}]'`,
  );
  console.log('communities.node_types default updated -> Group');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
