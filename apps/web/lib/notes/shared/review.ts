// The review agent's pure checks: schema gaps, broken links, orphans, unlinked
// mentions, staleness, expiry, supersession integrity, contradictions,
// duplicates, oversized notes. Produces a report of safe, reversible AUTO-FIXES
// (allow-listed) plus FINDINGS for a human — the agent never auto-applies a
// destructive change.

import type { NoteFrontmatter, NoteMeta, RawNote } from './types'
import { joinFrontmatter, normalizeKey, parseFrontmatter, splitFrontmatter } from './markdown'
import { computeReferences, escapeRegExp, linkFirstMention } from './references'
import { relatedNotes, tokenize, type RelatedDoc } from './related'
import {
  expiresAtOf,
  isRetired,
  statusOf,
  supersededByOf,
  supersedesOf,
  unknownLifecycleValues,
} from './lifecycle'

export interface ReviewThresholds {
  staleDays: number
  oversizeChars: number
  duplicateSim: number
  /**
   * How related two notes must be before their claims are compared for
   * conflict. Much lower than `duplicateSim` on purpose: a contradiction lives
   * between notes about the SAME subject that are otherwise quite different —
   * two near-identical notes are a duplicate, not a conflict.
   */
  contradictionSim: number
}

export const DEFAULT_THRESHOLDS: ReviewThresholds = {
  staleDays: 180,
  oversizeChars: 12000,
  duplicateSim: 0.65,
  contradictionSim: 0.35,
}

export interface ReviewInput {
  raws: RawNote[]
  metas: NoteMeta[]
  now: number
  thresholds: ReviewThresholds
  mode: 'light' | 'full'
  /** Paths frozen for maintenance (locked folders) — never auto-fixed. */
  frozen?: (path: string) => boolean
}

export type AutoFix =
  | { kind: 'fixBrokenLink'; path: string; from: string; to: string }
  | { kind: 'addMissingFrontmatter'; path: string; fields: Partial<NoteFrontmatter> }
  | { kind: 'linkMention'; path: string; title: string; targetPath: string }
  | { kind: 'setStale'; path: string }
  // The note's own `expires:` date has passed — the author asked for this.
  | { kind: 'setExpired'; path: string }
  // `path` is superseded by `byPath`, which says so in its own `supersedes:`.
  // Records the back-pointer and retires the replaced note.
  | { kind: 'linkSupersession'; path: string; byPath: string }

export interface Issue {
  path: string
  kind: string
  detail: string
  /** The second note of a pair issue (duplicate, contradiction) — what lets a later pass find the pair again. */
  other?: string
}

export interface ReviewReport {
  generatedAt: number
  mode: 'light' | 'full'
  autoFixes: AutoFix[]
  issues: Issue[]
  counts: Record<string, number>
}

const DAY_MS = 24 * 60 * 60 * 1000

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

function aliasesOf(m: NoteMeta): string[] {
  const a = Array.isArray(m.frontmatter.aliases) ? (m.frontmatter.aliases as unknown[]).map(String) : []
  return [m.title, ...a]
}

function baseName(p: string): string {
  return p.split('/').pop() ?? p
}

/** Resolve a broken link href to a unique existing note by basename. */
function resolveBrokenLink(
  href: string,
  metas: NoteMeta[],
): { to: string } | { ambiguous: true } | { none: true } {
  const raw = baseName(href).toLowerCase()
  const base = raw.endsWith('.md') ? raw : `${raw}.md`
  const matches = metas.filter((m) => baseName(m.path).toLowerCase() === base)
  if (matches.length === 1) return { to: matches[0].path }
  if (matches.length > 1) return { ambiguous: true }
  return { none: true }
}

/** Missing recommended frontmatter → fill what's derivable (auto), flag the rest. */
export function checkSchema(metas: NoteMeta[]): { fixes: AutoFix[]; issues: Issue[] } {
  const fixes: AutoFix[] = []
  const issues: Issue[] = []
  for (const m of metas) {
    const fm = m.frontmatter
    const fields: Partial<NoteFrontmatter> = {}
    if (isEmpty(fm.type)) fields.type = 'note'
    if (isEmpty(fm.title)) fields.title = m.title
    if (isEmpty(fm.timestamp)) fields.timestamp = new Date(m.mtime).toISOString()
    if (Object.keys(fields).length) fixes.push({ kind: 'addMissingFrontmatter', path: m.path, fields })
    if (isEmpty(fm.description)) {
      issues.push({ path: m.path, kind: 'schema', detail: 'missing description' })
    }
  }
  return { fixes, issues }
}

/** Broken links: a unique basename match is auto-fixed; otherwise reported. */
export function checkBrokenLinks(metas: NoteMeta[]): { fixes: AutoFix[]; issues: Issue[] } {
  const fixes: AutoFix[] = []
  const issues: Issue[] = []
  for (const m of metas) {
    for (const href of m.unresolved) {
      const r = resolveBrokenLink(href, metas)
      if ('to' in r) fixes.push({ kind: 'fixBrokenLink', path: m.path, from: href, to: r.to })
      else
        issues.push({
          path: m.path,
          kind: 'broken-link',
          detail: `${href} (${'ambiguous' in r ? 'ambiguous' : 'no target'})`,
        })
    }
  }
  return { fixes, issues }
}

/** Notes with no incoming links (invisible to navigation). */
export function checkOrphans(metas: NoteMeta[]): Issue[] {
  const incoming = new Set<string>()
  for (const m of metas) for (const t of m.linkTargets) incoming.add(t)
  return metas
    .filter((m) => !incoming.has(m.path))
    .map((m) => ({ path: m.path, kind: 'orphan', detail: 'no backlinks' }))
}

/**
 * Staleness: last modified longer ago than staleDays. Anything already retired
 * (stale, superseded, archived, …) is left alone — re-flagging a superseded
 * note as stale would overwrite the more specific reason it is out of date.
 */
export function checkStaleness(metas: NoteMeta[], now: number, staleDays: number): AutoFix[] {
  const out: AutoFix[] = []
  for (const m of metas) {
    if (isRetired(m.frontmatter)) continue
    if (now - m.mtime > staleDays * DAY_MS) out.push({ kind: 'setStale', path: m.path })
  }
  return out
}

/**
 * Expiry: the note's own `expires:` has passed. Unlike staleness this is not a
 * heuristic about neglect — the author declared a shelf life, so honouring it
 * is a mechanical fix, and it applies to entity and index notes too.
 */
export function checkExpiry(metas: NoteMeta[], now: number): AutoFix[] {
  const out: AutoFix[] = []
  for (const m of metas) {
    const at = expiresAtOf(m.frontmatter)
    if (at === null || at > now) continue
    if (statusOf(m.frontmatter) === 'expired') continue
    out.push({ kind: 'setExpired', path: m.path })
  }
  return out
}

/**
 * Lifecycle values that are not in the vocabulary. Cheap, exact, and worth its
 * own kind: a note whose `status:` is misspelled silently reads as ACTIVE, so
 * the author believes they retired it and every reader is told it is current.
 */
export function checkLifecycleFields(metas: NoteMeta[]): Issue[] {
  const out: Issue[] = []
  for (const m of metas) {
    for (const detail of unknownLifecycleValues(m.frontmatter)) {
      out.push({ path: m.path, kind: 'lifecycle', detail })
    }
  }
  return out
}

/**
 * Supersession integrity — the exact half of contradiction detection. A
 * `supersedes:` declaration is the one place an author states outright that one
 * note replaces another, so the graph it describes has to hold up:
 *
 *   • an unresolvable target is a broken claim, not a broken link;
 *   • the replaced note gets a `superseded_by:` back-pointer and `status:
 *     superseded` (the auto-fix) so a reader arriving at it directly is told;
 *   • mutual supersession (A replaces B, B replaces A) is a real conflict no
 *     machine can settle, so it is reported rather than fixed;
 *   • a note claiming to supersede itself is a copy-paste slip.
 *
 * Deliberately cheap and exact — it runs in both light and full mode.
 */
export function checkSupersession(metas: NoteMeta[]): { fixes: AutoFix[]; issues: Issue[] } {
  const fixes: AutoFix[] = []
  const issues: Issue[] = []
  const byPath = new Map(metas.map((m) => [m.path, m]))
  // Resolve a ref the way a reader would: exact path first, then a unique
  // basename match, so `supersedes: pricing` finds `decisions/pricing.md`.
  const resolve = (ref: string): string | null => {
    if (byPath.has(ref)) return ref
    const r = resolveBrokenLink(ref, metas)
    return 'to' in r ? r.to : null
  }

  const declared = new Map<string, Set<string>>() // replacement → replaced paths
  for (const m of metas) {
    for (const ref of supersedesOf(m.frontmatter)) {
      const target = resolve(ref)
      if (target === null) {
        issues.push({
          path: m.path,
          kind: 'supersession',
          detail: `supersedes "${ref}", which matches no note`,
        })
        continue
      }
      if (target === m.path) {
        issues.push({ path: m.path, kind: 'supersession', detail: 'supersedes itself' })
        continue
      }
      ;(declared.get(m.path) ?? declared.set(m.path, new Set()).get(m.path)!).add(target)
    }
  }

  const reported = new Set<string>()
  for (const [replacement, replacedSet] of declared) {
    for (const replaced of replacedSet) {
      if (declared.get(replaced)?.has(replacement)) {
        const key = [replacement, replaced].sort().join('|')
        if (!reported.has(key)) {
          reported.add(key)
          issues.push({
            path: replacement,
            kind: 'supersession',
            detail: `mutually supersedes ${replaced} — only one can be current; retire the other by hand`,
          })
        }
        continue
      }
      const target = byPath.get(replaced)!
      const backRef = supersededByOf(target.frontmatter)
      const resolvedBack = backRef ? resolve(backRef) : null
      if (resolvedBack !== null && resolvedBack !== replacement) {
        issues.push({
          path: replaced,
          kind: 'supersession',
          detail: `claimed by ${replacement} but already superseded_by ${resolvedBack}`,
        })
        continue
      }
      if (resolvedBack === replacement && statusOf(target.frontmatter) === 'superseded') continue
      fixes.push({ kind: 'linkSupersession', path: replaced, byPath: replacement })
    }
  }

  // A back-pointer nobody claims: the replacement was deleted or renamed away.
  for (const m of metas) {
    const backRef = supersededByOf(m.frontmatter)
    if (!backRef) continue
    if (resolve(backRef) === null) {
      issues.push({
        path: m.path,
        kind: 'supersession',
        detail: `superseded_by "${backRef}", which matches no note`,
      })
    }
  }

  return { fixes, issues }
}

/** Unlinked mentions: unambiguous title matches are auto-linked; ambiguous ones flagged. */
function checkUnlinkedMentions(
  raws: RawNote[],
  metas: NoteMeta[],
): { fixes: AutoFix[]; issues: Issue[] } {
  const fixes: AutoFix[] = []
  const issues: Issue[] = []
  const nameCount = new Map<string, number>()
  for (const m of metas)
    for (const name of aliasesOf(m)) {
      const key = normalizeKey(name)
      nameCount.set(key, (nameCount.get(key) ?? 0) + 1)
    }

  const seen = new Set<string>()
  for (const target of metas) {
    const ambiguous = (nameCount.get(normalizeKey(target.title)) ?? 0) > 1
    const refs = computeReferences(raws, target.path, metas)
    for (const u of refs.unlinked) {
      const key = `${u.fromPath}→${target.path}`
      if (seen.has(key)) continue
      seen.add(key)
      if (ambiguous)
        issues.push({
          path: u.fromPath,
          kind: 'unlinked-mention',
          detail: `mentions "${target.title}" (ambiguous)`,
        })
      else fixes.push({ kind: 'linkMention', path: u.fromPath, title: target.title, targetPath: target.path })
    }
  }
  return { fixes, issues }
}

/** One unordered pair of topically-related notes, scored by TF-IDF cosine. */
export interface NearPair {
  a: string
  b: string
  score: number
}

/**
 * Unique related-note pairs above `minScore`, computed once and shared by the
 * duplicate and contradiction checks (they want the same neighbourhood at
 * different thresholds, and the similarity pass is the expensive part).
 */
export function nearPairs(docs: RelatedDoc[], minScore: number, perDoc: number): NearPair[] {
  const seen = new Set<string>()
  const out: NearPair[] = []
  for (const doc of docs) {
    for (const rel of relatedNotes(docs, doc.path, { exclude: new Set([doc.path]), limit: perDoc })) {
      if (rel.score < minScore) continue
      const [a, b] = [doc.path, rel.path].sort()
      const key = `${a}|${b}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ a, b, score: rel.score })
    }
  }
  return out.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a))
}

/** Duplicate candidates (full pass): near-identical notes → flag for a merge. */
function checkDuplicates(pairs: NearPair[], titleOf: (p: string) => string, sim: number): Issue[] {
  return pairs
    .filter((p) => p.score >= sim)
    .map((p) => ({
      path: p.a,
      kind: 'duplicate',
      detail: `possible duplicate of ${titleOf(p.b)} (${p.score.toFixed(2)}) — consider merging`,
      other: p.b,
    }))
}

// Words that flip the meaning of a claim. Short and conservative on purpose:
// a false "these two notes disagree" costs an agent more than a missed one,
// because it invites a merge that destroys a distinction.
const NEGATIONS = new Set([
  'not', 'no', 'never', 'none', 'cannot', 'cant', 'dont', 'doesnt', 'didnt',
  'wont', 'isnt', 'arent', 'wasnt', 'shouldnt', 'without', 'avoid', 'stopped',
  'removed', 'dropped', 'deprecated', 'disabled',
])

const FENCE_RE = /^```/
// Numbers that carry meaning in prose: currency, percentages, plain quantities.
const NUMBER_RE = /[$£€]?\d[\d,]*(?:\.\d+)?%?/g
const DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4}\s*q[1-4]|q[1-4]\s*\d{4})\b/g

interface Claim {
  key: string
  text: string
  numbers: string
  dates: string
  negated: boolean
}

/** Strip markdown to the words a reader actually reads. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '') // list marker
    .replace(/^#{1,6}\s+/, '') // heading
    .replace(/^>\s*/, '') // quote
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images → their text
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sortedSet(values: string[]): string {
  return [...new Set(values.map((v) => v.toLowerCase().replace(/,/g, '')))].sort().join(',')
}

/**
 * The assertions in a note body, keyed by their opening topic words. Two lines
 * that open the same way are talking about the same thing; what follows is
 * where they can disagree. Fenced code is skipped — a config sample is not a
 * claim, and two versions of one differing is exactly what version control is
 * for.
 */
export function extractClaims(body: string): Claim[] {
  const out: Claim[] = []
  let inFence = false
  for (const raw of body.split('\n')) {
    if (FENCE_RE.test(raw.trim())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const text = plainLine(raw)
    if (text.length < 20) continue
    const tokens = tokenize(text)
    if (tokens.length < 4) continue
    out.push({
      key: tokens.slice(0, 4).join(' '),
      text,
      numbers: sortedSet(text.match(NUMBER_RE) ?? []),
      dates: sortedSet(text.toLowerCase().match(DATE_RE) ?? []),
      negated: text
        .toLowerCase()
        .split(/[^a-z']+/)
        .some((w) => NEGATIONS.has(w.replace(/'/g, ''))),
    })
  }
  return out
}

// Frontmatter keys that are bookkeeping, not assertions — two notes disagreeing
// on `title` or `timestamp` is not a contradiction, it is just two notes.
const NON_ASSERTED_KEYS = new Set([
  'title', 'description', 'timestamp', 'author', 'tags', 'aliases', 'type',
  'resource', 'status', 'confidence', 'expires', 'supersedes',
  'superseded_by', 'icon', 'image',
])

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim().toLowerCase()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

/**
 * Contradictions (full pass): two related notes that assert different things.
 *
 * This is the check duplicate-detection cannot do. A duplicate is two notes
 * saying the same thing and costs storage; a contradiction is two notes saying
 * DIFFERENT things and costs correctness — an agent retrieves one of them, at
 * random, and acts on it. Notion's own numbers on Lore put 15–20% of a memory
 * store at duplicates; the conflicting remainder is the half that actually
 * misleads.
 *
 * Purely mechanical, and it only ever reports — resolving a conflict is a
 * judgment call, so it comes back as a worklist item for the calling agent or a
 * human, never an auto-fix. Three kinds of evidence, cheapest first:
 *
 *   1. FIELD divergence — the two notes set the same frontmatter key to
 *      different scalars (`owner: ana` vs `owner: sam`).
 *   2. VALUE divergence — two lines that open with the same four topic words
 *      quote different numbers or dates.
 *   3. POLARITY divergence — two such lines where exactly one is negated.
 *
 * A pair where one note supersedes the other is skipped: that conflict is
 * already declared and resolved, which is the whole point of `supersedes:`.
 */
export function checkContradictions(
  pairs: NearPair[],
  metas: NoteMeta[],
  bodyByPath: Map<string, string>,
  sim: number,
): Issue[] {
  const byPath = new Map(metas.map((m) => [m.path, m]))
  const claimCache = new Map<string, Claim[]>()
  const claimsOf = (path: string): Claim[] => {
    const hit = claimCache.get(path)
    if (hit) return hit
    const claims = extractClaims(bodyByPath.get(path) ?? '')
    claimCache.set(path, claims)
    return claims
  }

  const out: Issue[] = []
  for (const pair of pairs) {
    if (pair.score < sim) continue
    const a = byPath.get(pair.a)
    const b = byPath.get(pair.b)
    if (!a || !b) continue
    // Already-settled conflicts, and anything one side has retired.
    if (supersedesOf(a.frontmatter).includes(b.path) || supersedesOf(b.frontmatter).includes(a.path)) continue
    if (isRetired(a.frontmatter) || isRetired(b.frontmatter)) continue

    const found: string[] = []

    for (const [key, av] of Object.entries(a.frontmatter)) {
      if (NON_ASSERTED_KEYS.has(key)) continue
      if (!(key in b.frontmatter)) continue
      const left = scalar(av)
      const right = scalar(b.frontmatter[key])
      if (left === null || right === null || left === right) continue
      found.push(`${key}: "${left}" vs "${right}"`)
    }

    if (found.length < 2) {
      const bClaims = new Map<string, Claim>()
      for (const c of claimsOf(b.path)) if (!bClaims.has(c.key)) bClaims.set(c.key, c)
      for (const ac of claimsOf(a.path)) {
        const bc = bClaims.get(ac.key)
        if (!bc) continue
        if (ac.numbers && bc.numbers && ac.numbers !== bc.numbers) {
          found.push(`"${ac.text}" vs "${bc.text}"`)
        } else if (ac.dates && bc.dates && ac.dates !== bc.dates) {
          found.push(`"${ac.text}" vs "${bc.text}"`)
        } else if (ac.negated !== bc.negated) {
          found.push(`"${ac.text}" vs "${bc.text}"`)
        }
        if (found.length >= 2) break
      }
    }

    if (!found.length) continue
    out.push({
      path: a.path,
      kind: 'contradiction',
      detail: `conflicts with ${b.title} (${b.path}) — ${found.slice(0, 2).join('; ')}`,
      other: b.path,
    })
  }
  return out
}

/** Oversized notes (full pass): flag for a split at H2 boundaries. */
function checkOversized(raws: RawNote[], oversizeChars: number): Issue[] {
  const out: Issue[] = []
  for (const r of raws) {
    const body = splitFrontmatter(r.content).body
    if (body.length <= oversizeChars) continue
    const sections = (body.match(/^##\s+/gm) ?? []).length
    out.push({
      path: r.path,
      kind: 'oversized',
      detail: `${body.length} chars, ${sections} sections — consider splitting`,
    })
  }
  return out
}

/** Apply one allow-listed auto-fix to a note's markdown, returning the new content. */
export function applyAutoFix(content: string, fix: AutoFix): string {
  const { frontmatter, body } = splitFrontmatter(content)
  const fm = parseFrontmatter(content)
  const rewrapBody = (b: string): string =>
    frontmatter != null ? `---\n${frontmatter}\n---\n\n${b}` : b
  switch (fix.kind) {
    case 'setStale':
      return joinFrontmatter({ ...fm, status: 'stale' }, body)
    case 'setExpired':
      return joinFrontmatter({ ...fm, status: 'expired' }, body)
    case 'linkSupersession':
      // Leading slash to match how links are written everywhere else, so the
      // back-pointer is clickable as well as machine-readable.
      return joinFrontmatter({ ...fm, status: 'superseded', superseded_by: `/${fix.byPath}` }, body)
    case 'addMissingFrontmatter':
      return joinFrontmatter({ ...fix.fields, ...fm }, body) // existing values win; only missing get filled
    case 'fixBrokenLink':
      return rewrapBody(
        body.replace(new RegExp(`\\]\\(${escapeRegExp(fix.from)}\\)`, 'g'), `](/${fix.to})`),
      )
    case 'linkMention':
      return rewrapBody(linkFirstMention(body, fix.title, fix.targetPath) ?? body)
  }
}

/** Run the checks for the mode and assemble the report. */
export function buildReviewReport(input: ReviewInput): ReviewReport {
  const frozen = input.frozen ?? (() => false)
  const autoFixes: AutoFix[] = []
  const issues: Issue[] = []

  const schema = checkSchema(input.metas)
  autoFixes.push(...schema.fixes)
  issues.push(...schema.issues)

  const broken = checkBrokenLinks(input.metas)
  autoFixes.push(...broken.fixes)
  issues.push(...broken.issues)

  autoFixes.push(...checkStaleness(input.metas, input.now, input.thresholds.staleDays))
  autoFixes.push(...checkExpiry(input.metas, input.now))

  // Exact, so it runs in both modes — a note whose replacement exists but does
  // not say so is the failure that makes a memory store untrustworthy fastest.
  const supersession = checkSupersession(input.metas)
  autoFixes.push(...supersession.fixes)
  issues.push(...supersession.issues)
  issues.push(...checkLifecycleFields(input.metas))

  const mentions = checkUnlinkedMentions(input.raws, input.metas)
  autoFixes.push(...mentions.fixes)
  issues.push(...mentions.issues)

  issues.push(...checkOrphans(input.metas))

  if (input.mode === 'full') {
    const bodyByPath = new Map(
      input.raws.map((r) => [r.path, splitFrontmatter(r.content).body]),
    )
    const docs: RelatedDoc[] = input.metas.map((m) => ({
      path: m.path,
      title: m.title,
      body: bodyByPath.get(m.path) ?? '',
    }))
    const titleByPath = new Map(input.metas.map((m) => [m.path, m.title]))
    // One similarity pass, at the lower of the two thresholds, shared by both
    // pair-wise checks.
    const pairs = nearPairs(
      docs,
      Math.min(input.thresholds.duplicateSim, input.thresholds.contradictionSim),
      3,
    )
    issues.push(
      ...checkDuplicates(pairs, (p) => titleByPath.get(p) ?? p, input.thresholds.duplicateSim),
    )
    issues.push(
      ...checkContradictions(pairs, input.metas, bodyByPath, input.thresholds.contradictionSim),
    )
    issues.push(...checkOversized(input.raws, input.thresholds.oversizeChars))
  }

  const applicable = autoFixes.filter((f) => !frozen(f.path))
  return {
    generatedAt: input.now,
    mode: input.mode,
    autoFixes: applicable,
    issues,
    counts: {
      autoFixes: applicable.length,
      issues: issues.length,
    },
  }
}
