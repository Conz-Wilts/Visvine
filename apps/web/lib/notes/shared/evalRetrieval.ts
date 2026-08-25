/**
 * The retrieval evaluation harness.
 *
 * `STAGE_WEIGHTS`, `RRF_K`, the BM25 title boost and the lifecycle multipliers
 * were all tuned by judgment. That is not a criticism of the judgment — it is
 * that without a fixed query set there is no way to tell a retrieval improvement
 * from a retrieval regression, so every future change to the ranking is an
 * argument rather than a measurement. For a product whose central claim is "the
 * AI knows your context", that is the number that matters most and the one we
 * did not have.
 *
 * This module supplies the metrics; `tests/fixtures/retrievalCorpus.ts` supplies
 * the corpus and the graded queries. Both are pure — no DB, no network, no API
 * key — so the whole evaluation runs inside `pnpm test` as a regression gate and
 * again from `pnpm eval:retrieval` when someone wants the per-query detail.
 *
 * What it measures, deliberately: the stack MINUS the vector stage. Embeddings
 * are injected and absent in tests, so these numbers grade BM25 + source
 * keyword + link-neighbourhood fusion + lifecycle ranking. That is the half that
 * is deterministic and the half a code change can break; the semantic half needs
 * a live model and belongs in a separate, slower harness. A number that only
 * moves when the code moves is worth more here than a truer one that drifts on
 * its own.
 */
import { fusedSearch, type FusedResult, type RetrievalNote, type SearchFilters } from './retrieval'

/**
 * One graded query. `relevant` is the set that SHOULD come back; `ideal` is the
 * order they should ideally come back in, when order is part of the claim (a
 * superseded note ranking below its replacement is the canonical example).
 */
export interface EvalQuery {
  /** Stable id, so a failing case is nameable in a diff. */
  id: string
  query: string
  filters?: SearchFilters
  /** Epoch ms the query is asked at — relative dates in it resolve against this. */
  now?: number
  /** Paths that are genuine hits for this query. */
  relevant: string[]
  /**
   * Optional stricter claim: these paths, in this order, relative to each other.
   * Paths not in the result set fail the claim; unrelated hits between them are
   * ignored, so this grades ORDER without over-specifying the whole ranking.
   */
  order?: string[]
  /** What this case is protecting. Printed on failure — a test that fails
   *  without saying what behaviour it encoded is a test people delete. */
  intent: string
}

interface QueryScore {
  id: string
  query: string
  intent: string
  /** Fraction of `relevant` that appeared in the top k. */
  recall: number
  /** 1/rank of the first relevant hit, 0 if none. */
  reciprocalRank: number
  /** Normalized discounted cumulative gain over the top k. */
  ndcg: number
  /** Whether the `order` claim held (true when the case makes none). */
  orderHeld: boolean
  /** The ranked paths actually returned, for the report. */
  returned: string[]
  missing: string[]
}

export interface EvalReport {
  k: number
  queries: QueryScore[]
  /** Mean recall@k across queries. */
  recall: number
  /** Mean reciprocal rank — how high the FIRST good answer lands. */
  mrr: number
  /** Mean nDCG@k — the ranking-quality number. */
  ndcg: number
  /** Fraction of order claims that held. */
  orderAccuracy: number
  failures: QueryScore[]
}

/**
 * Ideal DCG for n relevant documents: what the score would be if every relevant
 * hit occupied the top slots. Binary relevance, so gain is 1 per hit.
 */
function idealDcg(n: number, k: number): number {
  let sum = 0
  for (let i = 0; i < Math.min(n, k); i++) sum += 1 / Math.log2(i + 2)
  return sum
}

function scoreQuery(q: EvalQuery, hits: FusedResult[], k: number): QueryScore {
  const returned = hits.slice(0, k).map((h) => h.path)
  const relevant = new Set(q.relevant)

  let dcg = 0
  let found = 0
  let reciprocalRank = 0
  returned.forEach((path, i) => {
    if (!relevant.has(path)) return
    found += 1
    dcg += 1 / Math.log2(i + 2)
    if (reciprocalRank === 0) reciprocalRank = 1 / (i + 1)
  })

  // The order claim: every named path must be present, and their relative
  // positions must match. Anything ranked between them is irrelevant to it.
  let orderHeld = true
  if (q.order?.length) {
    const positions = q.order.map((p) => returned.indexOf(p))
    orderHeld =
      positions.every((pos) => pos >= 0) &&
      positions.every((pos, i) => i === 0 || pos > positions[i - 1])
  }

  const ideal = idealDcg(q.relevant.length, k)
  return {
    id: q.id,
    query: q.query,
    intent: q.intent,
    recall: q.relevant.length ? found / q.relevant.length : 1,
    reciprocalRank,
    ndcg: ideal ? dcg / ideal : 1,
    orderHeld,
    returned,
    missing: q.relevant.filter((p) => !returned.includes(p)),
  }
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1)

/**
 * Run every graded query against the corpus and score the results.
 *
 * A query is a FAILURE (and lands in `failures`) when it loses a relevant hit
 * entirely or breaks an order claim — those are the two ways retrieval goes
 * wrong in a way a person notices. A merely lower nDCG shows up in the aggregate
 * without failing anything, because ranking nudges are exactly what the harness
 * exists to let people make deliberately.
 */
export async function evaluateRetrieval(
  notes: RetrievalNote[],
  queries: EvalQuery[],
  k = 10,
): Promise<EvalReport> {
  const scores: QueryScore[] = []
  for (const q of queries) {
    const hits = await fusedSearch(notes, q.query, q.filters ?? {}, { k, now: q.now })
    scores.push(scoreQuery(q, hits, k))
  }
  return {
    k,
    queries: scores,
    recall: mean(scores.map((s) => s.recall)),
    mrr: mean(scores.map((s) => s.reciprocalRank)),
    ndcg: mean(scores.map((s) => s.ndcg)),
    orderAccuracy: mean(scores.map((s) => (s.orderHeld ? 1 : 0))),
    failures: scores.filter((s) => s.recall < 1 || !s.orderHeld),
  }
}

/** A fixed-width report for the CLI. Kept here so the script stays trivial. */
export function formatReport(report: EvalReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const lines: string[] = []
  lines.push(`Retrieval evaluation — ${report.queries.length} queries @ k=${report.k}`)
  lines.push('')
  lines.push(`  recall@${report.k}   ${pct(report.recall)}`)
  lines.push(`  MRR          ${report.mrr.toFixed(3)}`)
  lines.push(`  nDCG@${report.k}     ${report.ndcg.toFixed(3)}`)
  lines.push(`  order        ${pct(report.orderAccuracy)}`)
  lines.push('')

  const width = Math.max(...report.queries.map((q) => q.id.length), 8)
  lines.push(`  ${'case'.padEnd(width)}  recall   rr    nDCG  order`)
  for (const q of report.queries) {
    lines.push(
      `  ${q.id.padEnd(width)}  ${pct(q.recall).padStart(6)}  ${q.reciprocalRank
        .toFixed(2)
        .padStart(4)}  ${q.ndcg.toFixed(2).padStart(5)}  ${q.orderHeld ? '  ok' : 'FAIL'}`,
    )
  }

  if (report.failures.length) {
    lines.push('')
    lines.push(`  ${report.failures.length} failing case${report.failures.length === 1 ? '' : 's'}:`)
    for (const f of report.failures) {
      lines.push(`    ${f.id} — ${f.intent}`)
      lines.push(`      query:    ${f.query}`)
      if (f.missing.length) lines.push(`      missing:  ${f.missing.join(', ')}`)
      if (!f.orderHeld) lines.push(`      order:    broken`)
      lines.push(`      returned: ${f.returned.slice(0, 5).join(', ') || '(nothing)'}`)
    }
  }
  return lines.join('\n')
}
