/**
 * How a Tool's screens are judged by eye: the rubric a vision model scores a
 * screenshot against, the prompt that asks it, and the reading of its answer.
 * Pure — `lib/tools/visualReview.ts` does the asking.
 *
 * One rubric serves three readers: an author's review loop (`check_tool
 * { review: true }`), `build_tool`'s own fix rounds, and `pnpm eval:tools`,
 * which is how "is the Tool builder good" became a number.
 */

export const RUBRIC = [
  { key: 'hierarchy', label: 'Hierarchy', ask: 'Is it obvious what matters most? One clear focal area, headings and numbers sized by importance, nothing competing.' },
  { key: 'spacing', label: 'Spacing and alignment', ask: 'Consistent gutters and gaps, edges that line up, no cramped or collided elements, nothing cut off or overflowing.' },
  { key: 'density', label: 'Density', ask: 'Does the screen use its space well? No giant empty regions, no wall of undifferentiated text, no tiny content lost in a big frame.' },
  { key: 'data', label: 'Realistic content', ask: 'Does it show plausible, specific data (real-sounding names, amounts, dates) rather than placeholders, lorem ipsum, "Item 1", or an empty state as the first look?' },
  { key: 'affordance', label: 'Main action', ask: 'Is the main thing a person does here (add, vote, post, move) visible and clearly a control?' },
  { key: 'polish', label: 'Polish', ask: 'Does it look like a finished product from a well-designed SaaS app — coherent colour used for meaning, consistent components, no raw browser controls, no debug text or error cards?' },
] as const

type RubricKey = (typeof RUBRIC)[number]['key']

export interface VisualVerdict {
  /** 0–10, the mean of the rubric's scores, one decimal. */
  score: number
  /** Lowest category on any reviewed screen; averaging must not hide a failure. */
  minimumCategory?: number
  scores: Record<RubricKey, number>
  /** Concrete changes that would raise the score, most important first. */
  fixes: string[]
  /** One line on what the screen is. */
  summary: string
}

/** What the reviewer is told about the Tool, so it can judge fit as well as looks. */
export interface ReviewContext {
  request: string
  title: string
  /** Which screen this is: a section's name, or "a dialog after pressing New deal". */
  screen?: string
}

export function reviewPrompt(ctx: ReviewContext): string {
  return [
    'You are a demanding product designer reviewing one screen of an internal tool that runs inside a SaaS app (the app draws the sidebar and top band; you see only the tool\'s content area).',
    `The person asked for: "${ctx.request}". The tool is titled "${ctx.title}".${ctx.screen ? ` This screen is: ${ctx.screen}.` : ''}`,
    '',
    'Score each criterion from 0 to 10, where 10 is indistinguishable from a top-tier product (Linear, Notion, Stripe) and 5 is a competent but plain prototype:',
    ...RUBRIC.map((r) => `- ${r.key}: ${r.ask}`),
    '',
    'Then list up to 5 concrete fixes — each one sentence naming the element and the change ("Right-align the Value column", "Replace the empty state with sample deals"). No praise, no generic advice.',
    '',
    'Answer with JSON only:',
    `{"summary": "<one line>", "scores": {${RUBRIC.map((r) => `"${r.key}": <0-10>`).join(', ')}}, "fixes": ["…"]}`,
  ].join('\n')
}

/** The first JSON object in a model's answer, however it was wrapped. */
function firstObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const clamp = (n: number) => Math.max(0, Math.min(10, n))

/** A reviewer's answer read into a verdict, or null when it said nothing usable. */
export function parseVerdict(text: string): VisualVerdict | null {
  const raw = firstObject(text) as { summary?: unknown; scores?: Record<string, unknown>; fixes?: unknown } | null
  if (!raw || typeof raw.scores !== 'object' || raw.scores === null) return null
  const scores = {} as Record<RubricKey, number>
  for (const r of RUBRIC) {
    const n = raw.scores[r.key]
    if (typeof n !== 'number' || !Number.isFinite(n)) return null
    scores[r.key] = clamp(n)
  }
  const values = Object.values(scores)
  return {
    score: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
    scores,
    fixes: Array.isArray(raw.fixes) ? raw.fixes.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).slice(0, 5) : [],
    summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 200) : '',
  }
}

/**
 * Several screens into one verdict for the Tool: the mean score, the lowest
 * category anywhere (a Tool is as good as its worst screen), and the fixes
 * in screen order without repeats.
 */
export function combineVerdicts(verdicts: VisualVerdict[]): VisualVerdict | null {
  if (verdicts.length === 0) return null
  const scores = {} as Record<RubricKey, number>
  for (const r of RUBRIC) scores[r.key] = Math.round((verdicts.reduce((a, v) => a + v.scores[r.key], 0) / verdicts.length) * 10) / 10
  const seen = new Set<string>()
  const fixes: string[] = []
  for (const v of verdicts) {
    for (const f of v.fixes) {
      if (seen.has(f.toLowerCase())) continue
      seen.add(f.toLowerCase())
      fixes.push(f)
    }
  }
  return {
    score: Math.round((verdicts.reduce((a, v) => a + v.score, 0) / verdicts.length) * 10) / 10,
    scores,
    minimumCategory: Math.min(...verdicts.map((v) => v.minimumCategory ?? Math.min(...Object.values(v.scores)))),
    fixes: fixes.slice(0, 8),
    summary: verdicts.map((v) => v.summary).filter(Boolean).join(' · '),
  }
}

/** Good enough to hand over: a mean at the bar and no category that fails. */
export function passes(verdict: VisualVerdict, bar = 8.5): boolean {
  return verdict.score >= bar && (verdict.minimumCategory ?? 10) >= 6 && Object.values(verdict.scores).every((s) => s >= 6)
}
