// Picking one of a known list by MEANING — a recipe for a request, a skill for
// a run. The keyword matchers (lib/actions/shared/match.ts) stay: they are
// deterministic, free and the fallback whenever the judge gives no verdict, so
// neither deploy order nor a missing key decides whether a surface routes.
//
// The properties the keyword matcher's header promises still hold. The judge
// only ever picks among candidates that already exist; what is picked is
// advice, never authorization. "None fits" is always an option, and is
// preferred to a weak pick: a wrong suggestion can break a request that was
// fine without one.

import { decide } from './client'
import { choiceOf } from './shared/types'

export interface RouteCandidate {
  id: string
  /** One line: what it is for. */
  about: string
}

const ROUTE_DEADLINE_MS = 1_500
const MAX_CANDIDATES = 120
/** Under this the pick is not trusted and the caller falls back. */
export const ROUTE_CONFIDENCE = 0.6

export type RoutePick = { id: string; confidence: number; probabilities: Record<string, number> } | { id: null; confidence: number } | null

/** The candidate the request calls for, `{ id: null }` when the judge says none does, or null for no verdict. */
export async function pickByMeaning(request: string, candidates: readonly RouteCandidate[], instructions: string): Promise<RoutePick> {
  const list = candidates.slice(0, MAX_CANDIDATES)
  if (!request.trim() || list.length === 0) return null
  const criteria: Record<string, string> = { none: 'None of these is what the request calls for.' }
  list.forEach((c, i) => (criteria[`c${i}`] = c.about.slice(0, 300)))
  const answers = await decide({ request: request.slice(0, 2_000) }, { pick: { type: 'choice', instructions, criteria } }, { deadlineMs: ROUTE_DEADLINE_MS })
  const pick = choiceOf(answers, 'pick')
  if (!pick) return null
  if (pick.choice === 'none') return { id: null, confidence: pick.confidence }
  const chosen = list[Number(pick.choice.slice(1))]
  if (!chosen) return null
  const probabilities: Record<string, number> = {}
  list.forEach((c, i) => (probabilities[c.id] = pick.probabilities[`c${i}`] ?? 0))
  return { id: chosen.id, confidence: pick.confidence, probabilities }
}
