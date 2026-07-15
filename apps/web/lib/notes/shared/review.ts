// The review agent's pure checks — ported from blackbird-brain's
// src/shared/review.ts and adapted to Visvine's note shapes: schema gaps,
// broken links, orphans, unlinked mentions, staleness, duplicates, oversized
// notes. Produces a report of safe, reversible AUTO-FIXES (allow-listed) plus
// FINDINGS for a human — the agent never auto-applies a destructive change.

import type { NoteFrontmatter, NoteMeta, RawNote } from './types'
import { joinFrontmatter, normalizeKey, parseFrontmatter, splitFrontmatter } from './markdown'
import { computeReferences, linkFirstMention } from './references'
import { relatedNotes } from './related'

export interface ReviewThresholds {
  staleDays: number
  oversizeChars: number
  duplicateSim: number
}

export const DEFAULT_THRESHOLDS: ReviewThresholds = {
  staleDays: 180,
  oversizeChars: 12000,
  duplicateSim: 0.65,
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

export interface Issue {
  path: string
  kind: string
  detail: string
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

/** Staleness: last modified longer ago than staleDays (skips already-stale). */
export function checkStaleness(metas: NoteMeta[], now: number, staleDays: number): AutoFix[] {
  const out: AutoFix[] = []
  for (const m of metas) {
    if (m.frontmatter.status === 'stale' || m.frontmatter.status === 'archived') continue
    if (now - m.mtime > staleDays * DAY_MS) out.push({ kind: 'setStale', path: m.path })
  }
  return out
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
    for (const name of aliasesOf(m))
      nameCount.set(normalizeKey(name), (nameCount.get(normalizeKey(name)) ?? 0) + 1)

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

/** Duplicate candidates (full pass): near-identical notes → flag for a merge. */
function checkDuplicates(metas: NoteMeta[], raws: RawNote[], sim: number): Issue[] {
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  const docs = metas.map((m) => ({ path: m.path, title: m.title, body: bodyByPath.get(m.path) ?? '' }))
  const out: Issue[] = []
  const paired = new Set<string>()
  for (const doc of docs) {
    const related = relatedNotes(docs, doc.path, { exclude: new Set([doc.path]), limit: 1 })
    const top = related[0]
    if (!top || top.score < sim) continue
    const key = [doc.path, top.path].sort().join('|')
    if (paired.has(key)) continue
    paired.add(key)
    out.push({
      path: doc.path,
      kind: 'duplicate',
      detail: `possible duplicate of ${top.title} (${top.score.toFixed(2)}) — consider merging`,
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

  const mentions = checkUnlinkedMentions(input.raws, input.metas)
  autoFixes.push(...mentions.fixes)
  issues.push(...mentions.issues)

  issues.push(...checkOrphans(input.metas))

  if (input.mode === 'full') {
    issues.push(...checkDuplicates(input.metas, input.raws, input.thresholds.duplicateSim))
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
