/**
 * The live half of the retrieval evaluation: the graded query set with the
 * JUDGE in the rerank seat, against the real model.
 *
 *   pnpm eval:judge
 *
 * `pnpm eval:retrieval` grades the deterministic stack and never moves unless
 * the code does. This one spends (fractions of a cent) and needs
 * OPENROUTER_API_KEY. It answers the two questions the judge raises:
 *
 *   - does dropping ever lose a graded-relevant note?  (recall kept)
 *   - how much of what is not relevant does it remove? (noise dropped), and
 *     does a query the corpus cannot answer come back empty?
 *
 * Read the per-query lines when tuning SEARCH_RELEVANT_FLOOR.
 */
import { config } from 'dotenv'
config()

import { fusedSearch } from '../lib/notes/shared/retrieval'
import { corpusNotes, QUERIES } from '../tests/fixtures/retrievalCorpus'
import { createReranker, type RerankReport } from '../lib/notes/rerank'

/** Asked of the same corpus; nothing in it is about any of these. */
const UNANSWERABLE = [
  'what is the office wifi password',
  'who won the football on Saturday',
  'recipe for sourdough starter',
]

async function main(): Promise<void> {
  const k = Number(process.argv[2] ?? 10)
  const notes = corpusNotes()
  let relevantBefore = 0
  let relevantAfter = 0
  let noiseBefore = 0
  let noiseAfter = 0
  for (const q of QUERIES) {
    const opts = { k, now: q.now }
    const plain = await fusedSearch(notes, q.query, q.filters ?? {}, opts)
    const report: RerankReport = {}
    const judged = await fusedSearch(notes, q.query, q.filters ?? {}, { ...opts, rerank: createReranker(report) })
    const rel = new Set(q.relevant)
    const count = (hits: { path: string }[]) => hits.filter((h) => rel.has(h.path)).length
    relevantBefore += count(plain)
    relevantAfter += count(judged)
    noiseBefore += plain.length - count(plain)
    noiseAfter += judged.length - count(judged)
    const lost = plain.filter((h) => rel.has(h.path) && !judged.some((j) => j.path === h.path)).map((h) => h.path)
    console.log(
      `${report.judged ? ' ' : '!'} ${q.id.padEnd(28)} ${String(plain.length).padStart(2)} → ${String(judged.length).padStart(2)} hits` +
        `   relevant ${count(plain)} → ${count(judged)}   first: ${judged[0]?.path ?? '—'}` +
        (lost.length ? `   LOST ${lost.join(', ')}` : ''),
    )
  }
  console.log('')
  console.log(`relevant kept   ${relevantAfter} / ${relevantBefore}`)
  console.log(`noise dropped   ${noiseBefore - noiseAfter} / ${noiseBefore}`)
  console.log('')
  for (const query of UNANSWERABLE) {
    const plain = await fusedSearch(notes, query, {}, { k })
    const judged = await fusedSearch(notes, query, {}, { k, rerank: createReranker() })
    console.log(`  unanswerable: "${query}"   ${plain.length} → ${judged.length} hits${judged.length ? `   (${judged.map((h) => `${h.path} ${h.relevance ?? '?'}`).join(', ')})` : ''}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit())
