// The query plan: what a search is actually asking for, decided BEFORE any
// stage runs. Three things are read out of the query text —
//
//   - a date range ("last week", "in June 2024", "since March", "2026-03-15"),
//     which becomes a filter rather than being left to word overlap: a note
//     about last week rarely contains the words "last week";
//   - whether there is anything left to rank on once the time words are gone
//     ("what happened yesterday" is a question about a date, not about the
//     word "happened"), in which case text and vector stages are skipped and
//     the answer is the notes from that range by recency;
//   - whether the asker wants HISTORY ("why did we stop…", "what did we use
//     to…"), in which case a retired note is exactly what they are after and
//     the lifecycle down-ranking must not bury it.
//
// All of it is deterministic and free. An LLM rewrite (lib/notes/queryRewrite.ts)
// can widen the plan with alternate phrasings and a date range it inferred, and
// is merged in here — but a date the parser found always wins over one a model
// guessed, and nothing a model returns can do more than add phrasings and bounds.
//
// Days are UTC. Pure — no Prisma/Node/DOM imports.

import type { NoteMeta } from './types'

export interface DateRange {
  /** Inclusive epoch-ms lower bound, or null for "no lower bound". */
  start: number | null
  /** Inclusive epoch-ms upper bound, or null for "no upper bound". */
  end: number | null
}

/**
 * `current` (the default) wants what is true now; `history` wants what WAS
 * true, so retired notes rank at full weight.
 */
type QueryIntent = 'current' | 'history'

export interface QueryPlan {
  /** The query as asked, first, then any alternate phrasings. Never empty. */
  queries: string[]
  /** What is left to rank on once temporal phrases are removed. */
  topic: string
  dateRange: DateRange | null
  /** Nothing to rank on but time: answer by recency inside `dateRange`. */
  temporalOnly: boolean
  intent: QueryIntent
}

const DAY_MS = 24 * 60 * 60 * 1000

const MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
] as const

const MONTH_INDEX = new Map<string, number>()
MONTHS.forEach((names, i) => names.forEach((n) => MONTH_INDEX.set(n, i)))
const MONTH_RE = MONTHS.flat().join('|')

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  couple: 2,
  few: 3,
}

// UTC calendar arithmetic, all inclusive-bounds.

function dayStart(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
function dayEnd(ms: number): number {
  return dayStart(ms) + DAY_MS - 1
}
function monthRange(year: number, month: number): DateRange {
  return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) - 1 }
}
function yearRange(year: number): DateRange {
  return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) - 1 }
}
/** Monday 00:00 of the week containing `ms`. */
function weekStart(ms: number): number {
  const d = new Date(dayStart(ms))
  const offset = (d.getUTCDay() + 6) % 7
  return dayStart(ms) - offset * DAY_MS
}
function shiftMonths(ms: number, n: number): { year: number; month: number } {
  const d = new Date(ms)
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

/**
 * The month `name` most recently referred to: this year's unless that is still
 * ahead of `now`, in which case last year's — "in June" said in March is the
 * June that has happened.
 */
function recentMonth(name: string, now: number): { year: number; month: number } {
  const month = MONTH_INDEX.get(name)!
  const year = new Date(now).getUTCFullYear()
  return Date.UTC(year, month, 1) > now ? { year: year - 1, month } : { year, month }
}

/** The day-of-month of `now` in another month, clamped to that month's length. */
function sameDay(year: number, month: number, now: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(new Date(now).getUTCDate(), last))
}

function dayOf(year: number, month: number, day: number): DateRange | null {
  const ms = Date.UTC(year, month, day)
  if (new Date(ms).getUTCMonth() !== month) return null // 31 June
  return { start: ms, end: ms + DAY_MS - 1 }
}

type Rule = { re: RegExp; range: (m: RegExpMatchArray, now: number) => DateRange | null }

/**
 * The temporal grammar, matched anywhere in the query. Every rule's match is
 * removed from the text (the residue is the topic), and the ranges of every
 * rule that fired are intersected. `since X` / `before X` contribute one bound.
 */
const RULES: Rule[] = [
  // ISO dates, with or without a preposition: 2026-03-15, 2026-03.
  {
    re: /\b(?:on\s+|in\s+|since\s+|from\s+|before\s+|until\s+|after\s+)?(\d{4})-(\d{2})-(\d{2})\b/gi,
    range: (m) => {
      const r = dayOf(+m[1], +m[2] - 1, +m[3])
      return r && bound(m[0], r)
    },
  },
  {
    re: /\b(?:in\s+|since\s+|from\s+|before\s+|until\s+|after\s+)?(\d{4})-(\d{2})\b/gi,
    range: (m) => (+m[2] >= 1 && +m[2] <= 12 ? bound(m[0], monthRange(+m[1], +m[2] - 1)) : null),
  },
  // today / yesterday
  { re: /\btoday\b/gi, range: (_m, now) => ({ start: dayStart(now), end: dayEnd(now) }) },
  {
    re: /\byesterday\b/gi,
    range: (_m, now) => ({ start: dayStart(now) - DAY_MS, end: dayEnd(now) - DAY_MS }),
  },
  // this week / month / year — the calendar unit containing now.
  { re: /\bthis\s+week\b/gi, range: (_m, now) => ({ start: weekStart(now), end: dayEnd(now) }) },
  {
    re: /\bthis\s+month\b/gi,
    range: (_m, now) => ({ start: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1), end: dayEnd(now) }),
  },
  { re: /\bthis\s+year\b/gi, range: (_m, now) => ({ start: Date.UTC(new Date(now).getUTCFullYear(), 0, 1), end: dayEnd(now) }) },
  // last week / month / year — the previous calendar unit, whole.
  {
    re: /\blast\s+week\b/gi,
    range: (_m, now) => ({ start: weekStart(now) - 7 * DAY_MS, end: weekStart(now) - 1 }),
  },
  {
    re: /\blast\s+month\b/gi,
    range: (_m, now) => {
      const { year, month } = shiftMonths(now, -1)
      return monthRange(year, month)
    },
  },
  { re: /\blast\s+year\b/gi, range: (_m, now) => yearRange(new Date(now).getUTCFullYear() - 1) },
  // past week / past N days / last 30 days / in the last couple of weeks — rolling windows ending now.
  {
    re: /\b(?:in\s+the\s+|over\s+the\s+|within\s+the\s+)?(?:past|last|previous)\s+(?:(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(?:of\s+)?)?(days?|weeks?|months?|years?)\b/gi,
    range: (m, now) => {
      const n = m[1] ? (NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1])) : 1
      if (!Number.isFinite(n) || n <= 0 || n > 3650) return null
      const unit = m[2].toLowerCase()
      let start: number
      if (unit.startsWith('day')) start = dayStart(now) - (n - 1) * DAY_MS
      else if (unit.startsWith('week')) start = dayStart(now) - (7 * n - 1) * DAY_MS
      else if (unit.startsWith('month')) {
        const { year, month } = shiftMonths(now, -n)
        start = sameDay(year, month, now)
      } else {
        const d = new Date(now)
        start = sameDay(d.getUTCFullYear() - n, d.getUTCMonth(), now)
      }
      return { start, end: dayEnd(now) }
    },
  },
  // Month day[, year] / day Month [year]: "March 15", "15 March 2026", "Mar 3rd".
  {
    re: new RegExp(
      `\\b(?:(on|since|from|before|until|after)\\s+)?(?:(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})(?:,?\\s+(\\d{4}))?)\\b`,
      'gi',
    ),
    range: (m, now) => {
      const name = (m[2] ?? m[6]).toLowerCase()
      const day = +(m[3] ?? m[5])
      const year = m[4] ?? m[7]
      const { year: y, month } = year ? { year: +year, month: MONTH_INDEX.get(name)! } : recentMonth(name, now)
      const r = dayOf(y, month, day)
      return r && bound(m[1] ?? '', r)
    },
  },
  // Month year: "June 2024", "in Jan 2025".
  {
    re: new RegExp(`\\b(?:(in|during|since|from|before|until|after)\\s+)?(${MONTH_RE})\\s+(\\d{4})\\b`, 'gi'),
    range: (m) => bound(m[1] ?? '', monthRange(+m[3], MONTH_INDEX.get(m[2].toLowerCase())!)),
  },
  // Bare month with a preposition: "in June", "since March". A month name on
  // its own is not claimed — "may" is a verb and "March" can be a surname.
  {
    re: new RegExp(`\\b(in|during|since|from|before|until|after)\\s+(${MONTH_RE})\\b`, 'gi'),
    range: (m, now) => {
      const { year, month } = recentMonth(m[2].toLowerCase(), now)
      return bound(m[1], monthRange(year, month))
    },
  },
  // Bare year with a preposition: "in 2025", "since 2024".
  {
    re: /\b(in|during|since|from|before|until|after)\s+((?:19|20)\d{2})\b/gi,
    range: (m) => bound(m[1], yearRange(+m[2])),
  },
]

/** `since X` keeps only X's start; `before/until X` only its end; else both. */
function bound(prefix: string, r: DateRange): DateRange {
  const word = prefix.trim().toLowerCase().split(/\s+/)[0]
  if (word === 'since' || word === 'from' || word === 'after') return { start: r.start, end: null }
  if (word === 'before' || word === 'until') return { start: null, end: r.end }
  return r
}

function intersect(a: DateRange | null, b: DateRange): DateRange {
  if (!a) return b
  return {
    start: a.start === null ? b.start : b.start === null ? a.start : Math.max(a.start, b.start),
    end: a.end === null ? b.end : b.end === null ? a.end : Math.min(a.end, b.end),
  }
}

/**
 * Words that carry no topic once the time words are gone. "what happened last
 * week" reduces to nothing; "pricing changes last week" keeps "pricing changes".
 */
const FILLER = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'and', 'or',
  'what', 'which', 'who', 'when', 'where', 'how', 'did', 'do', 'does', 'was', 'were',
  'is', 'are', 'be', 'been', 'has', 'have', 'had', 'we', 'i', 'you', 'me', 'my', 'our',
  'it', 'there', 'that', 'this', 'these', 'those', 'any', 'anything', 'everything',
  'all', 'some', 'something', 'happened', 'happen', 'happening', 'went', 'going', 'go',
  'changed', 'change', 'changes', 'new', 'recent', 'latest', 'updates', 'update', 'updated',
  'notes', 'note', 'activity', 'events', 'things', 'stuff', 'show', 'list', 'find',
  'get', 'give', 'tell', 'about', 'during', 'since', 'up', 'so', 'far', 'on',
])

/** Phrases that ask about what USED to be true rather than what is. */
const HISTORY_MARKERS = [
  /\bwhy\s+(?:did|do|have)\s+we\s+(?:stop|drop|change|move|switch|abandon|retire|replace|leave|remove|kill)\b/i,
  /\bused\s+to\b/i,
  /\bpreviously\b/i,
  /\bformerly\b/i,
  /\boriginally\b/i,
  /\bhistory\s+of\b/i,
  /\bno\s+longer\b/i,
  /\bold\s+(?:pricing|policy|price|version|way|approach|process|model|plan|rule|setup|decision)\b/i,
  /\b(?:earlier|previous|original|superseded|deprecated|retired)\s+(?:version|decision|policy|approach|plan|pricing|process)\b/i,
  /\bbefore\s+(?:we|the)\s+(?:changed|switched|moved|dropped|stopped|replaced)\b/i,
  /\bwhat\s+(?:did|was)\s+(?:we|it|the\s+\w+)\s+(?:do|use|charge|have|say)\s+before\b/i,
]

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
}

/** The deterministic plan for a query. `now` is epoch ms (relative dates). */
export function planQuery(query: string, now: number): QueryPlan {
  let residue = query
  let dateRange: DateRange | null = null
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    const matches = [...residue.matchAll(rule.re)]
    for (const m of matches) {
      const r = rule.range(m, now)
      if (!r) continue
      dateRange = intersect(dateRange, r)
      residue = residue.replace(m[0], ' ')
    }
  }
  // A range whose bounds crossed (e.g. "since June before March") is nonsense;
  // keep the query as text rather than filter everything out.
  if (dateRange && dateRange.start !== null && dateRange.end !== null && dateRange.start > dateRange.end) {
    dateRange = null
    residue = query
  }

  const topic = residue.replace(/\s+/g, ' ').trim()
  const topical = words(topic).filter((w) => !FILLER.has(w))
  const temporalOnly = dateRange !== null && topical.length === 0
  const intent: QueryIntent = HISTORY_MARKERS.some((re) => re.test(query)) ? 'history' : 'current'

  return { queries: [query.trim()], topic: temporalOnly ? '' : topic || query.trim(), dateRange, temporalOnly, intent }
}

// LLM rewrite — untrusted output, coerced here.

/** What a query-rewrite model is asked to return. */
export interface QueryRewrite {
  /** Alternate phrasings of the same ask — never includes the original. */
  queries: string[]
  dateRange: DateRange | null
}

const MAX_ALTERNATES = 3
const MAX_ALTERNATE_CHARS = 200

function parseIso(v: unknown, endOfDay: boolean): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(s)
  const ms = Date.parse(bare ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : s)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Validate/repair a model's rewrite. Drops empty, over-long and duplicate
 * phrasings and the original itself; caps the count; parses the date range
 * and discards one whose bounds crossed. Returns null when nothing useful
 * survived, so the caller falls back to the plain plan.
 */
export function coerceQueryRewrite(raw: unknown, original: string): QueryRewrite | null {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const seen = new Set([original.trim().toLowerCase()])
  const queries: string[] = []
  for (const q of Array.isArray(r.queries) ? r.queries : []) {
    if (typeof q !== 'string') continue
    const s = q.replace(/\s+/g, ' ').trim()
    if (!s || s.length > MAX_ALTERNATE_CHARS || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    queries.push(s)
    if (queries.length >= MAX_ALTERNATES) break
  }
  let dateRange: DateRange | null = null
  const dr = typeof r.dateRange === 'object' && r.dateRange !== null ? (r.dateRange as Record<string, unknown>) : null
  if (dr) {
    const start = parseIso(dr.start, false)
    const end = parseIso(dr.end, true)
    if ((start !== null || end !== null) && !(start !== null && end !== null && start > end)) {
      dateRange = { start, end }
    }
  }
  if (!queries.length && !dateRange) return null
  return { queries, dateRange }
}

/**
 * Widen a plan with a rewrite: alternates are appended after the original; a
 * date range is taken from the model only when the parser found none. Whether
 * the search is temporal-only is decided by the parser alone — a model saying
 * "this is about last week" must not switch off the text stages.
 */
export function mergeRewrite(plan: QueryPlan, rewrite: QueryRewrite | null): QueryPlan {
  if (!rewrite) return plan
  const queries = [...plan.queries]
  for (const q of rewrite.queries) if (!queries.some((x) => x.toLowerCase() === q.toLowerCase())) queries.push(q)
  return { ...plan, queries, dateRange: plan.dateRange ?? rewrite.dateRange }
}

// Applying the plan.

/**
 * When a note is "from", for the date filter and the temporal-only ranking: its
 * frontmatter `date:` when it carries one (a meeting note is about the day it
 * records, not the day it was last touched), else `timestamp:`, else mtime.
 */
export function noteTimeOf(meta: Pick<NoteMeta, 'mtime' | 'frontmatter'>): number {
  for (const key of ['date', 'timestamp'] as const) {
    const v = meta.frontmatter[key]
    const ms = typeof v === 'string' ? parseIso(v, false) : v instanceof Date ? v.getTime() : null
    if (ms !== null) return ms
  }
  return meta.mtime
}

/** Whether a note's time falls inside the (possibly half-open) range. */
export function inDateRange(time: number, r: DateRange): boolean {
  if (r.start !== null && time < r.start) return false
  if (r.end !== null && time > r.end) return false
  return true
}
