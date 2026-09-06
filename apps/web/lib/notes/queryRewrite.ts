// The query plan as the server builds it: the deterministic plan
// (shared/queryPlan.ts) widened by one structured LLM call that proposes
// alternate phrasings and a date range the parser may have missed.
//
// The call is optional in every sense. Unconfigured (no OPENROUTER_API_KEY) or
// switched off by the caller, the plan is the parser's alone; a failure is
// logged and reported, never surfaced as a failed search. It is also skipped
// where it cannot help — a bare keyword or a name has no useful paraphrase, and
// a temporal-only ask runs no text stage for a paraphrase to feed. What comes
// back is treated as untrusted (coerceQueryRewrite) and can only ADD to the
// plan: phrasings, and bounds the parser left open.

import { aiConfigured, chat, extractJsonObject } from './ai'
import { coerceQueryRewrite, mergeRewrite, planQuery, type QueryPlan } from './shared/queryPlan'
import { logger } from '@/lib/logger'

export type RewriteStatus = 'on' | 'off' | 'skipped' | 'error'

/** Queries with this many words or fewer are keywords, not questions. */
const MIN_REWRITE_WORDS = 3

const SYSTEM =
  'You rewrite search queries for a knowledge base of short markdown notes about people, companies, decisions, meetings and events. ' +
  'Return ONLY a JSON object of the shape {"queries": string[], "dateRange": {"start": string|null, "end": string|null}}.\n' +
  'Instructions:\n' +
  '1. Give 2-3 alternative phrasings that would find the same notes — different vocabulary, a more specific or more general form, the noun phrase behind a question. NO MORE than 3. Never repeat the original.\n' +
  '2. If the query refers to a time (a date, "yesterday", "last quarter", "June 2024", "the week of the offsite"), give the date range as ISO dates (YYYY-MM-DD); otherwise both null. ' +
  'For relative dates use the reference date given.\n' +
  '3. Do not answer the query. Do not add facts. Keep each phrasing under 15 words.'

async function rewriteQuery(query: string, now: number): Promise<ReturnType<typeof coerceQueryRewrite>> {
  const today = new Date(now).toISOString().slice(0, 10)
  const raw = await chat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Reference date: ${today}\nQuery: ${query}` },
  ])
  return coerceQueryRewrite(extractJsonObject(raw), query)
}

/** The plan a search runs, and whether the rewrite contributed to it. */
export async function planSearch(
  query: string,
  now: number,
  opts: { rewrite: boolean },
): Promise<{ plan: QueryPlan; rewrite: RewriteStatus }> {
  const plan = planQuery(query, now)
  if (!opts.rewrite || !aiConfigured()) return { plan, rewrite: 'off' }
  if (plan.temporalOnly || query.trim().split(/\s+/).length <= MIN_REWRITE_WORDS) {
    return { plan, rewrite: 'skipped' }
  }
  try {
    return { plan: mergeRewrite(plan, await rewriteQuery(query, now)), rewrite: 'on' }
  } catch (err) {
    // The rewrite is a recall aid; the search must not fail because it did.
    logger.warn('notes.search.rewrite_failed', { err })
    return { plan, rewrite: 'error' }
  }
}
