/**
 * Backfill the retrieval embeddings: every note vector, and any source chunk
 * that was stored without one.
 *
 * Both vector stages are lazy — lib/notes/vectorStage.ts embeds at most 100
 * stale notes per query, and lib/notes/sources/ingest.ts stores chunks with
 * `model = null` when embedding fails or no key was configured at upload time.
 * Those chunks never rank semantically again, because nothing re-ingests them.
 * So after turning OPENAI_API_KEY on (or rotating EMBED_MODEL) run this once:
 * it makes the first real searches fast and makes old uploads findable.
 *
 * Idempotent: a note whose cached mtime already matches is skipped, and chunks
 * that already carry the current model are left alone.
 *
 * Usage:
 *   pnpm --filter @visvine/web exec tsx scripts/embed-context.ts                 # all brains
 *   pnpm --filter @visvine/web exec tsx scripts/embed-context.ts <communityId>   # one community
 */

import 'dotenv/config';
import prisma from '../lib/prisma';
import type { Brain } from '../lib/notes/store';
import { getVault } from '../lib/notes/vaultCache';
import { splitFrontmatter } from '../lib/notes/shared/markdown';
import { embedTexts, embeddingsConfig } from '../lib/notes/embeddings';
import { vectorLiteral } from '../lib/notes/vectorStage';

// Matches vectorStage.EMBED_CHARS — the same text must produce the same vector.
const EMBED_CHARS = 6000;
const BATCH = 32;

async function main() {
  const config = embeddingsConfig();
  if (!config) {
    console.error('OPENAI_API_KEY is not set — nothing to embed. Set it and re-run.');
    process.exit(1);
  }
  const only = process.argv[2];
  const where = only ? { communityId: only } : {};
  console.log(`Embedding with ${config.model}${only ? ` for ${only}` : ' (all communities)'}…`);

  const brainRows = await prisma.communityNote.groupBy({
    by: ['communityId', 'ownerKey'],
    where: { ...where, deletedAt: null },
  });
  const brains: Brain[] = brainRows.map((b) => ({ communityId: b.communityId, ownerKey: b.ownerKey }));
  if (only && brains.length === 0) throw new Error(`No notes found for community: ${only}`);

  let embedded = 0;
  for (const brain of brains) {
    const { raws, metas } = await getVault(brain);
    const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]));

    const cached = await prisma.communityNoteEmbedding.findMany({
      where: { communityId: brain.communityId, ownerKey: brain.ownerKey, model: config.model },
      select: { path: true, mtime: true },
    });
    const cachedMtime = new Map(cached.map((r) => [r.path, Number(r.mtime)]));
    const stale = metas.filter((m) => cachedMtime.get(m.path) !== m.mtime);
    if (stale.length === 0) continue;

    for (let i = 0; i < stale.length; i += BATCH) {
      const batch = stale.slice(i, i + BATCH);
      const vectors = await embedTexts(
        batch.map((m) => `${m.title}\n${bodyByPath.get(m.path) ?? ''}`.slice(0, EMBED_CHARS)),
      );
      for (let j = 0; j < batch.length; j++) {
        const literal = vectorLiteral(vectors[j]);
        await prisma.$executeRaw`
          INSERT INTO community_note_embeddings (id, community_id, owner_key, path, model, mtime, embedding, updated_at)
          VALUES ((gen_random_uuid())::text, ${brain.communityId}, ${brain.ownerKey}, ${batch[j].path}, ${config.model}, ${BigInt(batch[j].mtime)}, ${literal}::vector, now())
          ON CONFLICT (community_id, owner_key, path)
          DO UPDATE SET model = ${config.model}, mtime = ${BigInt(batch[j].mtime)}, embedding = ${literal}::vector, updated_at = now()`;
      }
      embedded += batch.length;
    }
    console.log(`  ${brain.communityId} [${brain.ownerKey}] — ${stale.length} notes`);
  }

  // Source chunks: anything not already on the current model, in path order so a
  // failure mid-run leaves a clean prefix and re-running resumes.
  const chunks = await prisma.contextSourceChunk.findMany({
    where: { ...where, OR: [{ model: null }, { model: { not: config.model } }] },
    select: { id: true, text: true },
    orderBy: { id: 'asc' },
  });
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embedTexts(batch.map((c) => c.text));
    for (let j = 0; j < batch.length; j++) {
      await prisma.$executeRaw`
        UPDATE context_source_chunks
        SET model = ${config.model}, embedding = ${vectorLiteral(vectors[j])}::vector
        WHERE id = ${batch[j].id}`;
    }
  }

  console.log(`Done: ${embedded} notes, ${chunks.length} source chunks.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
