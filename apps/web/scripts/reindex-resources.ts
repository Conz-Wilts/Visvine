/**
 * Push every un-indexed Drive file through the RAG pipeline.
 *
 *   pnpm --filter @visvine/web exec tsx scripts/reindex-resources.ts [--space <id>] [--all] [--dry]
 *
 * The backfill the resources_drive migration leaves behind. Every file uploaded
 * before that migration is `index_state = 'pending'`, because the pipeline did
 * not exist when it was stored — its bytes are in GCS and its contents are
 * invisible to search. This walks those rows, downloads each object, extracts,
 * chunks and embeds it, and points the record at the resulting ContextSource.
 *
 * By default it only touches `pending` and `failed` rows. `--all` re-indexes
 * everything, which is what you want after changing the embedding model or the
 * chunker (both change what a chunk IS, so old chunks are not comparable).
 *
 * Sequential and slow on purpose: each file is a download plus batched embedding
 * calls against a rate-limited API, and a parallel sweep buys wall-clock at the
 * cost of hitting that limit and failing rows that would otherwise succeed.
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { reindexResource } from '../lib/resources/service'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const only = arg('space')
  const all = process.argv.includes('--all')
  const dry = process.argv.includes('--dry')

  const rows = await prisma.resource.findMany({
    where: {
      ...(only ? { spaceId: only } : {}),
      ...(all ? {} : { indexState: { in: ['pending', 'failed'] } }),
      gcsPath: { not: null },
    },
    select: { id: true, name: true, spaceId: true, indexState: true, fileType: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`${rows.length} file(s) to index${all ? ' (--all)' : ''}${only ? ` in ${only}` : ''}.`)
  if (dry) {
    for (const r of rows) console.log(`  [${r.indexState}] ${r.spaceId} ${r.name}`);
    return
  }

  const counts: Record<string, number> = { indexed: 0, unsupported: 0, failed: 0, pending: 0 }
  for (const row of rows) {
    try {
      const updated = await reindexResource(row.id)
      const state = updated?.indexState ?? 'failed'
      counts[state] = (counts[state] ?? 0) + 1
      const detail = updated?.indexState === 'indexed' ? `${updated.chunkCount} chunks` : (updated?.indexError ?? '')
      console.log(`  ${state.padEnd(11)} ${row.name}${detail ? ` — ${detail}` : ''}`)
    } catch (err) {
      counts.failed += 1
      console.log(`  failed      ${row.name} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(
    `\nDone: ${counts.indexed} indexed, ${counts.unsupported} unsupported, ${counts.failed} failed.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
