/**
 * One-off migration for the 2026-08 vocabulary rename, TWO renames in one pass:
 *
 *   structural 'space'  -> 'section'   (the channels-tool container)
 *   org 'community'     -> 'space'     (the directory organisation type,
 *                                       previously organization -> group -> community)
 *
 * ORDER IS LOAD-BEARING: because 'space' changes meaning, the space->section
 * statements must run BEFORE the community->space ones in every table, or the
 * freshly renamed sections would be re-renamed / two distinct types would merge
 * in the per-community node_types de-dupe. The same four places as the prior
 * renames (rename-group-to-community.ts) are rewritten in place:
 *   1. nodes.type                     — old structural values -> 'section',
 *                                       then every org spelling -> 'space'
 *   2. communities.node_types         — the base type names in per-community config
 *   3. communities.community_aliases  — re-points aliases scoped to Space/Community
 *   4. communities.node_types DEFAULT — so new communities seed 'Space'
 *
 * Unlike the prior scripts, nodes.type is written LOWERCASE: today's writers
 * (createEntity, syncEntityNode) store lowercase-canonical, and
 * conversationService exact-matches lowercase 'section'. Colours/shapes/icons
 * are kept — this is a name-only rewrite; where renaming would collide with a
 * type the community already had, the duplicate collapses and the entry that
 * came first in the array wins.
 *
 * TYPE_SYNONYMS keeps 'community' (and the older org spellings) rendering as
 * Space, but there is deliberately NO synonym for un-migrated structural
 * 'space' rows — this script is MANDATORY on every database the new code
 * serves, local and prod. Note frontmatter (`type: Community`) is left alone;
 * synonyms cover its rendering, matching the precedent.
 *
 * Idempotent: re-running is a no-op once every row is renamed. Not guarded to
 * local-only — it must also run against prod (via the Cloud SQL proxy,
 * immediately after the code deploy). Point DATABASE_URL / DIRECT_DATABASE_URL
 * at the target DB before running.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/rename-community-to-space.ts            # apply
 *   pnpm --filter @visvine/web exec tsx scripts/rename-community-to-space.ts --dry-run  # report only
 */

import 'dotenv/config';
import prisma from '../lib/prisma';

const dryRun = process.argv.includes('--dry-run');

const ORG_SPELLINGS = `('community','communities','organization','organisation','org','group','groups','company','companies')`;
const STRUCTURAL_SPELLINGS = `('space','spaces')`;

/**
 * The nodes.type predicate for STRUCTURAL rows only. After the first run,
 * 'space' is the canonical ORG value, so matching the string alone would
 * re-rename the freshly migrated org rows on a re-run (not idempotent). A
 * structural container row always carries `metadata.sectionId` (RECORD_KEY in
 * lib/notes/context/entityNodes.ts — how the row is found for its
 * ChannelSection); an org row never does. That makes the predicate correct in
 * BOTH states, which is what idempotency requires.
 */
const STRUCTURAL_NODE_PREDICATE = `lower("type") IN ${STRUCTURAL_SPELLINGS} AND "metadata" ? 'sectionId'`;

// Must stay in sync with the `nodeTypes` @default in prisma/schema.prisma.
const NEW_DEFAULT =
  '[{"icon": "👤", "name": "Person", "color": "#2563eb", "shape": "rectangle"}, {"icon": "🏘️", "name": "Space", "color": "#78d870", "shape": "square"}, {"icon": "📅", "name": "Event", "color": "#ef4444", "shape": "rectangle"}]';

/**
 * node_types rewrite for one rename, old-name predicate -> new display name.
 *
 * `guard` is the idempotency latch for the Space->Section pass: a config's
 * "Space" entry is only the OLD structural type while the config still carries
 * an un-migrated org entry (Community/Group/...). Once the org entry has become
 * "Space", re-running must not chain it onward to "Section" — so the Section
 * pass only touches configs where the org marker is still present. (A config
 * that somehow had a structural Space entry but no org entry is skipped; the
 * dry run reports nothing for it and it can be fixed by hand.)
 */
function nodeTypesRewrite(oldNames: string, newName: string, guard?: string): string {
  return `UPDATE "communities" c
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
                     WHEN lower(e->>'name') IN ${oldNames}
                       THEN e || '{"name": "${newName}"}'::jsonb
                     ELSE e
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
           ${guard ? `AND ${guard}` : ''}
       ) sub
       WHERE c."id" = sub."id"
         AND sub.arr IS NOT NULL`;
}

/** True while the community's node_types still carries an un-migrated org entry. */
const NODE_TYPES_ORG_MARKER = `EXISTS (
  SELECT 1 FROM jsonb_array_elements(c2."node_types"::jsonb) g(e2)
  WHERE lower(g.e2->>'name') IN ${ORG_SPELLINGS}
)`;

function aliasesRewrite(oldNames: string, newName: string, guard?: string): string {
  return `UPDATE "communities"
       SET "community_aliases" = (
         SELECT jsonb_agg(
           CASE WHEN lower(elem->>'nodeType') IN ${oldNames}
                THEN jsonb_set(elem, '{nodeType}', '"${newName}"')
                ELSE elem END
         )
         FROM jsonb_array_elements("community_aliases"::jsonb) AS elem
       )
       WHERE "community_aliases" IS NOT NULL
         AND jsonb_typeof("community_aliases"::jsonb) = 'array'
         AND jsonb_array_length("community_aliases"::jsonb) > 0
         ${guard ? `AND ${guard}` : ''}`;
}

/** Same latch for aliases: a 'Space'-scoped alias is only structural while an
 *  un-migrated org-scoped alias is still present in the same array. */
const ALIASES_ORG_MARKER = `EXISTS (
  SELECT 1 FROM jsonb_array_elements("community_aliases"::jsonb) g(e2)
  WHERE lower(g.e2->>'nodeType') IN ${ORG_SPELLINGS}
)`;

async function main() {
  if (dryRun) {
    const [{ count: sectionCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "nodes" WHERE ${STRUCTURAL_NODE_PREDICATE}`,
    );
    const [{ count: strayCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "nodes"
         WHERE lower("type") IN ${STRUCTURAL_SPELLINGS} AND NOT ("metadata" ? 'sectionId')`,
    );
    if (Number(strayCount) > 0) {
      console.log(
        `[dry-run] WARNING: ${strayCount} 'space' node(s) carry no metadata.sectionId — on an ` +
          `un-migrated DB these are structural rows the predicate will MISS; inspect them first. ` +
          `On an already-migrated DB they are org rows and this is expected.`,
      );
    }
    const [{ count: spaceCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "nodes" WHERE lower("type") IN ${ORG_SPELLINGS}`,
    );
    const [{ count: commCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "communities"
         WHERE "node_types"::text ILIKE '%"name": "Space"%'
            OR "node_types"::text ILIKE '%"name": "Community"%'
            OR "community_aliases"::text ILIKE '%"nodeType": "Community"%'
            OR "community_aliases"::text ILIKE '%"nodeType": "Space"%'`,
    );
    console.log(`[dry-run] structural nodes -> 'section': ${sectionCount}`);
    console.log(`[dry-run] org nodes        -> 'space':   ${spaceCount}`);
    console.log(`[dry-run] communities whose config may rewrite: ${commCount}`);
    return;
  }

  // 1a. Structural rows FIRST — frees the 'space' name for the org type. The
  // metadata.sectionId discriminator keeps this from touching org rows that
  // already migrated to 'space' (see STRUCTURAL_NODE_PREDICATE).
  const sections = await prisma.$executeRawUnsafe(
    `UPDATE "nodes" SET "type" = 'section' WHERE ${STRUCTURAL_NODE_PREDICATE}`,
  );
  console.log(`nodes renamed -> section: ${sections}`);

  // 1b. Every org spelling — including the previous canonical 'community'.
  const spaces = await prisma.$executeRawUnsafe(
    `UPDATE "nodes" SET "type" = 'space' WHERE lower("type") IN ${ORG_SPELLINGS}`,
  );
  console.log(`nodes renamed -> space: ${spaces}`);

  // 2. Per-community node_types config, in the SAME order. The Section pass is
  // latched on the un-migrated org marker so re-runs can't chain Space onward.
  const sectionTypes = await prisma.$executeRawUnsafe(
    nodeTypesRewrite(STRUCTURAL_SPELLINGS, 'Section', NODE_TYPES_ORG_MARKER),
  );
  console.log(`communities.node_types Space->Section rewritten: ${sectionTypes}`);
  const spaceTypes = await prisma.$executeRawUnsafe(nodeTypesRewrite(ORG_SPELLINGS, 'Space'));
  console.log(`communities.node_types Community->Space rewritten: ${spaceTypes}`);

  // 3. Alias nodeType scopes, same order and same latch.
  const sectionAliases = await prisma.$executeRawUnsafe(
    aliasesRewrite(STRUCTURAL_SPELLINGS, 'Section', ALIASES_ORG_MARKER),
  );
  console.log(`communities.community_aliases Space->Section rewritten: ${sectionAliases}`);
  const spaceAliases = await prisma.$executeRawUnsafe(aliasesRewrite(ORG_SPELLINGS, 'Space'));
  console.log(`communities.community_aliases Community->Space rewritten: ${spaceAliases}`);

  // 4. Column default for new communities.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "communities"
       ALTER COLUMN "node_types"
       SET DEFAULT '${NEW_DEFAULT}'`,
  );
  console.log('communities.node_types default updated -> Space');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
