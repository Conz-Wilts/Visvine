/**
 * The one door for writing a Space's five JSON configuration columns —
 * `nodeTypes`, `aliases`, `linkTypes`, `designConfig`, `featureConfig`.
 *
 * Every one of them is edited read-modify-write: load the array/object, change
 * a bit of it, write the whole thing back. Done as two loose statements that is
 * a lost update waiting to happen, and it has happened: a console panel saving
 * `featureConfig` used to wipe the keys another panel owned, and a Types page
 * save from a minutes-old snapshot still deletes types a member created since
 * (which is why `mergeNodeTypeList` exists). Each incident got its own rescue —
 * `mergeFeatureConfig`, `mergeNodeTypeList`, a hand-written `tagColors`
 * carve-out — and the next new sub-key would have needed another one.
 *
 * This closes the class instead. `updateSpaceConfig` serializes the whole
 * read → decide → write per space with a transaction-scoped advisory lock, and
 * re-reads the columns INSIDE the lock so the merge always folds onto what is
 * really stored, not onto a snapshot from before the wait. The lock releases at
 * commit. Same pattern as the RSVP capacity check in lib/eventRepo.ts, which is
 * the other place in the app where a read decides a write.
 *
 * The callback also receives the transaction client, so work that must land
 * atomically with the JSON write — the alias delete cascade over UserAlias,
 * ContextGrant and Node — runs under the same lock and the same commit.
 *
 * Merging is NOT done here. Every column has a pure merge function
 * (lib/types/nodeTypeRegistry.ts, lib/types/linkTypeRegistry.ts,
 * lib/types/aliasRegistry.ts, lib/featureAccess.ts) that the callback applies,
 * so the interesting rules stay unit-testable without a database.
 */

import { revalidateTag } from 'next/cache';
import type { Prisma, Space } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { NodeTypeConfig, SpaceAlias, LinkTypeConfig } from '@/lib/types/context';
import type { SpaceDesignConfig, SpaceFeatureConfig } from '@/lib/types/space';

/** The five JSON columns, decoded. Arrays stay nullable — a space seeded before
 *  a column existed has `null`, which is not the same as "empty vocabulary". */
export interface SpaceConfig {
  nodeTypes: NodeTypeConfig[] | null;
  aliases: SpaceAlias[] | null;
  linkTypes: LinkTypeConfig[] | null;
  designConfig: SpaceDesignConfig;
  featureConfig: SpaceFeatureConfig;
}

/** The subset a writer changes. Columns left out are not written at all. */
export type SpaceConfigPatch = Partial<SpaceConfig>;

export class UnknownSpaceError extends Error {
  constructor(spaceId: string) {
    super(`Unknown space "${spaceId}"`);
    this.name = 'UnknownSpaceError';
  }
}

type ConfigRow = {
  nodeTypes: Prisma.JsonValue | null;
  aliases: Prisma.JsonValue | null;
  linkTypes: Prisma.JsonValue | null;
  designConfig: Prisma.JsonValue;
  featureConfig: Prisma.JsonValue;
};

/** Decode a raw row into the typed shape. Prisma types JSON columns
 *  structurally; these casts are the single place that assertion is made. */
function decodeSpaceConfig(row: ConfigRow): SpaceConfig {
  return {
    nodeTypes: (row.nodeTypes ?? null) as unknown as NodeTypeConfig[] | null,
    aliases: (row.aliases ?? null) as unknown as SpaceAlias[] | null,
    linkTypes: (row.linkTypes ?? null) as unknown as LinkTypeConfig[] | null,
    designConfig: (row.designConfig ?? {}) as unknown as SpaceDesignConfig,
    featureConfig: (row.featureConfig ?? {}) as unknown as SpaceFeatureConfig,
  };
}

/** Only the columns the patch actually mentions, cast for Prisma's JSON input. */
function encodePatch(patch: SpaceConfigPatch): Prisma.SpaceUpdateInput {
  const data: Record<string, unknown> = {};
  if (patch.nodeTypes !== undefined) data.nodeTypes = patch.nodeTypes as unknown as object;
  if (patch.aliases !== undefined) data.aliases = patch.aliases as unknown as object;
  if (patch.linkTypes !== undefined) data.linkTypes = patch.linkTypes as unknown as object;
  if (patch.designConfig !== undefined) data.designConfig = patch.designConfig as unknown as object;
  if (patch.featureConfig !== undefined) data.featureConfig = patch.featureConfig as unknown as object;
  return data as Prisma.SpaceUpdateInput;
}

/** Drop the cached space/context payloads that embed these columns. */
export function bustSpaceConfigCache(): void {
  try {
    revalidateTag('context-data-v2', { expire: 0 });
  } catch {
    /* outside a request scope (scripts, background sweeps) */
  }
}

export interface UpdateSpaceConfigOptions {
  /** Extra fields on the same row to write in the same statement — the console
   *  settings PUT changes `name`/`visibility` alongside its JSON. */
  also?: Prisma.SpaceUpdateInput;
  /** Skip the cache bust (callers that revalidate more tags themselves). */
  skipRevalidate?: boolean;
  /** Skip mirroring into `settings/*.md`. Set by the note→column hook, which is
   *  already reacting to the note: rewriting it would discard the author's own
   *  wording and key order for no gain. */
  skipNoteSync?: boolean;
}

export interface UpdateSpaceConfigResult {
  /** The five JSON columns as they now stand. */
  config: SpaceConfig;
  /** The whole row after the write, for callers that echo the space back. */
  space: Space;
}

/**
 * Serialize a read-modify-write over a space's config columns.
 *
 * `apply` is called with the stored config as it exists under the lock, and
 * returns only the columns it wants changed. Returning an empty patch is a
 * no-op write (the lock and transaction still guarantee the read was
 * consistent, which is what "nothing to change" callers need).
 *
 * Throws `UnknownSpaceError` if the space is gone. Anything `apply` throws
 * rolls the transaction back, so a refusal mid-merge leaves nothing half-written
 * — the ordering bug in the old `reconcilePersonAliases`, which cascaded
 * deletes before the authoritative write, is not expressible here.
 */
export async function updateSpaceConfig(
  spaceId: string,
  apply: (
    stored: SpaceConfig,
    tx: Prisma.TransactionClient,
  ) => SpaceConfigPatch | Promise<SpaceConfigPatch>,
  options: UpdateSpaceConfigOptions = {},
): Promise<UpdateSpaceConfigResult> {
  const result = await prisma.$transaction(async (tx) => {
    // ::text cast — pg_advisory_xact_lock returns `void`, which Prisma's
    // $queryRaw cannot deserialize ("Failed to deserialize column of type 'void'").
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${spaceId})::bigint)::text`;

    const row = await tx.space.findUnique({ where: { id: spaceId } });
    if (!row) throw new UnknownSpaceError(spaceId);

    const stored = decodeSpaceConfig(row);
    const patch = await apply(stored, tx);

    const data = { ...encodePatch(patch), ...(options.also ?? {}) };
    const space = Object.keys(data).length
      ? await tx.space.update({ where: { id: spaceId }, data })
      : row;

    return { config: { ...stored, ...patch }, space };
  });

  // The note mirror, AFTER the transaction: syncConfigNotes writes through the
  // note store, which takes its own connections and fires its own hooks, so it
  // must not run inside the advisory lock this function holds. Imported lazily
  // because that module imports the store, which imports the config hook, which
  // imports this file — a static import here would close the cycle.
  if (!options.skipNoteSync) {
    const { syncConfigNotes } = await import('./configNoteSync');
    await syncConfigNotes(result.space, result.config);
  }

  if (!options.skipRevalidate) bustSpaceConfigCache();
  return result;
}

/** The config columns as stored, without taking a lock — for readers that want
 *  the same decoding. Writers must go through `updateSpaceConfig`. */
export async function readSpaceConfig(spaceId: string): Promise<SpaceConfig | null> {
  const row = await prisma.space.findUnique({ where: { id: spaceId } });
  return row ? decodeSpaceConfig(row) : null;
}
