/**
 * Which space in the family a text is for. Pure.
 *
 * A line belongs to a HOUSE. The texter may also be in some of its rooms, and
 * a room with its own `phone` agent (or a run-in copy of the house's) is a
 * place a text could land. The candidate set is the texter's own standing —
 * the house if they are in it, the rooms they are in — and nothing outside it
 * is ever a target, whatever the text says.
 *
 * Order of decision, cheapest first: one candidate → it; the text names a
 * room (or IS a room's name, which moves the thread there) → it; the thread
 * already points at a candidate → stay; otherwise the caller asks the judge,
 * and failing that asks the person.
 */

export interface TargetCandidate {
  spaceId: string
  name: string
  /** The house itself, as opposed to one of its rooms. */
  house: boolean
}

export type TargetPick =
  | { kind: 'target'; spaceId: string; /** The text was only the room's name: switch, run nothing. */ switched: boolean }
  | { kind: 'ask'; candidates: TargetCandidate[] }
  | { kind: 'undecided'; candidates: TargetCandidate[] }

function nameRe(name: string): RegExp {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu')
}

/** The candidate the text names outright, when exactly one is. */
export function namedCandidate(text: string, candidates: readonly TargetCandidate[]): TargetCandidate | null {
  const hits = candidates.filter((c) => nameRe(c.name).test(text))
  return hits.length === 1 ? hits[0] : null
}

/** Is the whole text just a candidate's name — "Design", "design please", "→ Acme"? */
export function switchTo(text: string, candidates: readonly TargetCandidate[]): TargetCandidate | null {
  const bare = text
    .toLowerCase()
    .replace(/\b(please|pls|switch|go|to|move|in|use|the)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  if (!bare) return null
  const hits = candidates.filter((c) => c.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === bare)
  return hits.length === 1 ? hits[0] : null
}

export function pickTarget(
  text: string,
  candidates: readonly TargetCandidate[],
  current: string | null,
): TargetPick {
  if (candidates.length === 0) return { kind: 'ask', candidates: [] }
  if (candidates.length === 1) return { kind: 'target', spaceId: candidates[0].spaceId, switched: false }
  const only = switchTo(text, candidates)
  if (only) return { kind: 'target', spaceId: only.spaceId, switched: true }
  const named = namedCandidate(text, candidates)
  if (named) return { kind: 'target', spaceId: named.spaceId, switched: false }
  if (current && candidates.some((c) => c.spaceId === current)) return { kind: 'target', spaceId: current, switched: false }
  return { kind: 'undecided', candidates: [...candidates] }
}

/** "Acme or Design?" — the question when nothing decided. */
export function askWhich(candidates: readonly TargetCandidate[]): string {
  const names = candidates.map((c) => c.name)
  if (names.length <= 1) return 'Which space?'
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}?`
}
