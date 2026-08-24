/**
 * Matching a request to the recipes that answer it.
 *
 * Pure, deterministic and free: a weighted term overlap, no model call. Two
 * properties matter more than cleverness here.
 *
 * It cannot hallucinate. Scoring only ever RANKS candidates that already exist,
 * and every action a chosen recipe names is resolved against the registry
 * before it is offered — so the worst a bad match costs is irrelevant advice.
 *
 * It survives YAML. Rules are terms and weights, not regular expressions, so a
 * recipe round-trips through a note's frontmatter unchanged and an admin can
 * add one by writing a note. It also means nothing compiles a pattern supplied
 * by content, which is a class of problem worth not having.
 */

/**
 * One scoring rule: every term in `all` must appear in the prompt for `score`
 * to count. Substrings, so the stem 'creat' covers create/creating/created.
 */
export interface KeywordRule {
  all: string[]
  score: number
}

/**
 * Cross-product shorthand: `kw('creat|add', 'connector', 10)` is two rules.
 * An empty `nouns` means the verbs stand alone.
 */
export function kw(verbs: string, nouns: string, score: number): KeywordRule[] {
  const ns = nouns ? nouns.split('|') : ['']
  return verbs.split('|').flatMap((v) => ns.map((n) => ({ all: n ? [v, n] : [v], score })))
}

export interface MatchCandidate {
  id: string
  keywords: readonly KeywordRule[]
}

export interface Match {
  id: string
  score: number
}

/** Lower-cased, punctuation flattened to spaces, so terms match word-ish runs. */
export function normalise(prompt: string): string {
  return ` ${prompt.toLowerCase().replace(/[^a-z0-9.'_-]+/g, ' ').trim()} `
}

/** Score every candidate against the prompt, best first. Ties break by id, so
 *  the same prompt always produces the same plan. */
export function scoreCandidates(
  prompt: string,
  candidates: readonly MatchCandidate[],
): Match[] {
  const text = normalise(prompt)
  return candidates
    .map((c) => ({
      id: c.id,
      score: c.keywords.reduce(
        (sum, rule) => (rule.all.every((term) => text.includes(term)) ? sum + rule.score : sum),
        0,
      ),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

/**
 * How much to trust the top match. Calibrated against the shipped weights: a
 * single "creat* … connector" hit is 10 and is decisive; a bare mention of the
 * word "connector" is 2 and is not.
 */
export function confidenceOf(matches: readonly Match[]): 'high' | 'medium' | 'low' {
  const top = matches[0]?.score ?? 0
  const next = matches[1]?.score ?? 0
  if (top >= 8 && top > next) return 'high'
  if (top >= 5) return 'medium'
  return 'low'
}
