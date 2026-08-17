/**
 * Live proof that concurrent writes to a Space's JSON config columns no longer
 * lose each other — the thing no unit test can show, because the bug only
 * exists between two database round-trips.
 *
 * Each check fires N writers at one space simultaneously, every one of them
 * adding a distinct entry, then reads the column back and counts. A lost update
 * shows up as a missing entry. Run this against the OLD code and the counts come
 * up short; against lib/spaces/spaceConfig.ts they don't, because the advisory
 * lock makes every writer re-read what the previous one committed.
 *
 * This writes to the database, so it is guarded to a local one and cleans up
 * after itself by restoring each column to what it found.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/verify-space-concurrency.ts [spaceId]
 */
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import prisma from '../lib/prisma';
import { updateSpaceConfig, readSpaceConfig } from '../lib/spaces/spaceConfig';
import { mergeNodeTypeList } from '../lib/types';
import { mergeFeatureConfig } from '../lib/featureAccess';
import { mergeAliasList, mergeLinkTypeList, mergeDesignConfig, newAliasId } from '../lib/spaces/configMerge';

const WRITERS = 12;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        ${detail}`);
  if (ok) pass++;
  else fail++;
}

/** Fire `WRITERS` writes at once, each adding one uniquely-named entry. */
async function race(add: (i: number) => Promise<unknown>): Promise<void> {
  await Promise.all(Array.from({ length: WRITERS }, (_, i) => add(i)));
}

async function main() {
  const spaceId =
    process.argv[2] ??
    (await prisma.space.findFirst({ where: { personalOwnerId: null }, select: { id: true } }))?.id;
  if (!spaceId) throw new Error('no space to test against — seed one first');

  const before = await readSpaceConfig(spaceId);
  if (!before) throw new Error(`unknown space ${spaceId}`);
  console.log(`racing ${WRITERS} concurrent writers at ${spaceId}\n`);

  try {
    // ── node types: the column that already had a merge, now also locked ──
    await race((i) =>
      updateSpaceConfig(spaceId, (stored) => ({
        nodeTypes: mergeNodeTypeList(stored.nodeTypes, [
          { name: `RaceType${i}`, color: '#123456', shape: 'rectangle' },
        ]),
      })),
    );
    let after = await readSpaceConfig(spaceId);
    let landed = (after?.nodeTypes ?? []).filter((t) => t.name.startsWith('RaceType')).length;
    check('nodeTypes', landed === WRITERS, `${landed}/${WRITERS} concurrent type additions survived`);

    // ── link types: previously written verbatim, with no merge at all ──
    await race((i) =>
      updateSpaceConfig(spaceId, (stored) => ({
        linkTypes: mergeLinkTypeList(stored.linkTypes, [
          { name: `RaceLink${i}`, color: '#123456', directed: false },
        ]),
      })),
    );
    after = await readSpaceConfig(spaceId);
    landed = (after?.linkTypes ?? []).filter((t) => t.name.startsWith('RaceLink')).length;
    check('linkTypes', landed === WRITERS, `${landed}/${WRITERS} concurrent link-type additions survived`);

    // ── aliases: shared by the console, the API and MCP ──
    await race((i) =>
      updateSpaceConfig(spaceId, (stored) => ({
        aliases: mergeAliasList(stored.aliases, [
          { id: newAliasId(), name: `RaceAlias${i}`, color: '#123456', nodeType: 'Person' },
        ]),
      })),
    );
    after = await readSpaceConfig(spaceId);
    landed = (after?.aliases ?? []).filter((a) => a.name.startsWith('RaceAlias')).length;
    check('aliases', landed === WRITERS, `${landed}/${WRITERS} concurrent alias additions survived`);

    // ── designConfig.tagColors: any member can write this from anywhere ──
    await race((i) =>
      updateSpaceConfig(spaceId, (stored) => ({
        designConfig: mergeDesignConfig(stored.designConfig, { tagColors: { [`racetag${i}`]: '#123456' } }),
      })),
    );
    after = await readSpaceConfig(spaceId);
    landed = Object.keys(after?.designConfig.tagColors ?? {}).filter((k) => k.startsWith('racetag')).length;
    check('designConfig.tagColors', landed === WRITERS, `${landed}/${WRITERS} concurrent tag colours survived`);

    // ── featureConfig.enabled: two console panels toggling different tools ──
    await race((i) =>
      updateSpaceConfig(spaceId, (stored) => ({
        featureConfig: mergeFeatureConfig(stored.featureConfig, { enabled: { [`racetool${i}`]: true } }),
      })),
    );
    after = await readSpaceConfig(spaceId);
    landed = Object.keys(after?.featureConfig.enabled ?? {}).filter((k) => k.startsWith('racetool')).length;
    check('featureConfig.enabled', landed === WRITERS, `${landed}/${WRITERS} concurrent tool toggles survived`);
  } finally {
    // Put the space back exactly as it was, whatever happened above.
    await updateSpaceConfig(spaceId, () => before);
    console.log('\nrestored the space to its original config');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
