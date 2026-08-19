/**
 * Tenant-scoped byte purge: the bulk half of "bytes have exactly one owner".
 *
 * Single-row deletes already removed their object (`deleteResource`,
 * `sourceStore.deleteSource`). Bulk deletes did not, and there were exactly two
 * of them — dropping a space and closing an account — each of which used
 * `deleteMany` and so never went near the code that knows about buckets. Both
 * now call in here first.
 *
 * Three properties this is built for:
 *
 * - **Best-effort, never blocking.** An orphaned object costs storage; a failed
 *   delete that aborts the transaction costs the user their delete. Every call
 *   logs and continues. scripts/gc-orphan-objects.ts is what makes the miss
 *   temporary rather than permanent.
 * - **Bytes first, rows second.** Run before the rows go, because the rows are
 *   how you find the bytes for the entity-keyed media bucket. A failure here
 *   leaves rows AND bytes — recoverable. The other order leaves bytes with
 *   nothing pointing at them, which is what the reconciliation sweep then has
 *   to guess about.
 * - **Unconfigured storage is not an error.** Local dev has no buckets; the
 *   whole module no-ops rather than throwing on a missing env var.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { deleteObjectsByPrefix } from '@/lib/gcs';
import {
  NODE_MEDIA_TYPES,
  contextSourcesPrefix,
  mediaPrefix,
  spaceContextSourcesPrefix,
  spaceResourcesPrefix,
} from './objectPaths';

export interface PurgeResult {
  /** Objects removed from GCS_RESOURCES_BUCKET (Drive files + source originals). */
  resources: number;
  /** Objects removed from GCS_MEDIA_BUCKET (space, card, person and event images). */
  media: number;
  /** Prefixes that failed; the reconciliation sweep is what catches these. */
  failures: number;
}

const EMPTY: PurgeResult = { resources: 0, media: 0, failures: 0 };

function resourcesBucket(): string | null {
  return process.env.GCS_RESOURCES_BUCKET || null;
}

function mediaBucket(): string | null {
  return process.env.GCS_MEDIA_BUCKET || null;
}

/** Delete a prefix, swallowing (and recording) failure. */
async function sweep(
  bucket: string | null,
  prefix: string,
  result: PurgeResult,
  field: 'resources' | 'media',
  context: Record<string, unknown>,
): Promise<void> {
  if (!bucket) return;
  try {
    result[field] += await deleteObjectsByPrefix(bucket, prefix);
  } catch (err) {
    result.failures += 1;
    logger.error('storage.purge.failed', {
      ...context,
      prefix,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Every object a space owns.
 *
 * MUST be called before the space row is deleted: the media bucket is keyed by
 * entity id, so the node ids are only discoverable while the nodes still exist.
 */
export async function purgeSpaceObjects(spaceId: string): Promise<PurgeResult> {
  const result: PurgeResult = { ...EMPTY };
  const res = resourcesBucket();
  const med = mediaBucket();
  if (!res && !med) return result;

  const ctx = { spaceId };

  // The Drive and every context's uploaded originals. Both are tenant-prefixed,
  // so this is two calls regardless of how many files the space held.
  await sweep(res, spaceResourcesPrefix(spaceId), result, 'resources', ctx);
  await sweep(res, spaceContextSourcesPrefix(spaceId), result, 'resources', ctx);

  // The space's own logo.
  await sweep(med, mediaPrefix('space', spaceId), result, 'media', ctx);

  // Card / person / event images are keyed by NODE id, so they have to be
  // enumerated. Only nodes that actually carry an image are worth walking —
  // that is a handful of rows in a directory of thousands, and the sweep in
  // scripts/gc-orphan-objects.ts is the backstop for anything this misses
  // (a node whose imageUrl was cleared without its bytes going).
  if (med) {
    const nodes = await prisma.node.findMany({
      where: { spaceId, imageUrl: { not: null } },
      select: { id: true },
    });
    for (const node of nodes) {
      for (const type of NODE_MEDIA_TYPES) {
        await sweep(med, mediaPrefix(type, node.id), result, 'media', { ...ctx, nodeId: node.id });
      }
    }
  }

  logger.info('storage.purge.space', { spaceId, ...result });
  return result;
}

/**
 * The images belonging to specific nodes — the per-row half of the media bucket.
 *
 * Called wherever a node is deleted on its own (a card removed from a directory,
 * an event cancelled, an entity note's node pruned). Each of those used to leave
 * its images behind for the same reason the bulk paths did: nothing on the
 * deletion path knew about buckets.
 *
 * A node's images could have been uploaded under any of the three entity kinds
 * that key by node id, and the row does not record which — so all three prefixes
 * are swept. They are cheap: a prefix with nothing under it is one list call.
 */
export async function purgeNodeObjects(nodeIds: string[]): Promise<PurgeResult> {
  const result: PurgeResult = { ...EMPTY };
  const med = mediaBucket();
  if (!med || nodeIds.length === 0) return result;

  for (const nodeId of nodeIds) {
    for (const type of NODE_MEDIA_TYPES) {
      await sweep(med, mediaPrefix(type, nodeId), result, 'media', { nodeId });
    }
  }
  return result;
}

/**
 * Every object one person owns inside spaces that OUTLIVE them — the originals
 * uploaded into their personal context in each space they were a member of.
 *
 * Their personal SPACE is not handled here: that whole space is deleted on
 * account close, so it goes through `purgeSpaceObjects` like any other.
 */
export async function purgePersonalContextObjects(
  userId: string,
  spaceIds: string[],
): Promise<PurgeResult> {
  const result: PurgeResult = { ...EMPTY };
  const res = resourcesBucket();
  if (!res || spaceIds.length === 0) return result;

  for (const spaceId of spaceIds) {
    await sweep(res, contextSourcesPrefix(spaceId, userId), result, 'resources', {
      userId,
      spaceId,
    });
  }

  logger.info('storage.purge.personalContext', { userId, spaces: spaceIds.length, ...result });
  return result;
}
