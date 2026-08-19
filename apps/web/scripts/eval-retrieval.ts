/**
 * Print the retrieval evaluation report.
 *
 *   pnpm eval:retrieval
 *
 * The same graded query set the regression gate (tests/retrieval-eval.test.ts)
 * runs, but with the per-case detail — which is what you want when you are
 * changing STAGE_WEIGHTS, the lifecycle multipliers or the BM25 boosts and need
 * to see WHICH case moved rather than only that the aggregate did.
 *
 * Pure: no database, no API key, no network. Grades the deterministic half of
 * the stack (BM25 + link neighbourhood + lifecycle); the vector stage is
 * injected and absent here on purpose — see lib/notes/shared/evalRetrieval.ts.
 */
import { evaluateRetrieval, formatReport } from '../lib/notes/shared/evalRetrieval'
import { corpusNotes, QUERIES } from '../tests/fixtures/retrievalCorpus'

async function main(): Promise<void> {
  const k = Number(process.argv[2] ?? 10)
  const report = await evaluateRetrieval(corpusNotes(), QUERIES, k)
  console.log(formatReport(report))
  console.log('')
  if (report.failures.length) {
    console.log(`${report.failures.length} case(s) failing — see above.`)
    process.exitCode = 1
  } else {
    console.log('All graded cases pass.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
