// Unit tests for the context maintenance layer: ## Log stamping + capture lines
// (noteLog), link rewriting on moves (linkRewrite), the review agent's pure
// checks/auto-fixes (review), and enrichment candidate selection + LLM output
// coercion (enrichment). Fixtures go through the real index pipeline
// (buildNoteIndex). Run: node --import tsx --test tests/context-maintenance.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  appendNoteLogEntry,
  formatCaptureEntry,
  parseCaptureEntries,
  provenanceRef,
  stampProvenance,
  toDateTimeString,
} from '../lib/notes/shared/noteLog'
import { rewriteLinks } from '../lib/notes/shared/linkRewrite'
import {
  applyAutoFix,
  buildReviewReport,
  checkBrokenLinks,
  checkContradictions,
  checkExpiry,
  checkLifecycleFields,
  checkOrphans,
  checkSchema,
  checkStaleness,
  checkSupersession,
  extractClaims,
  nearPairs,
  DEFAULT_THRESHOLDS,
} from '../lib/notes/shared/review'
import {
  expiresAtOf,
  normalizeNoteRef,
  statusOf,
  supersededByOf,
  supersedesOf,
} from '../lib/notes/shared/lifecycle'
import {
  coerceEnrichmentOutput,
  selectEnrichmentCandidates,
  type EnrichmentSource,
} from '../lib/notes/shared/enrichment'
import { buildNoteIndex } from '../lib/notes/shared/context'
import { parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown'
import type { RawNote } from '../lib/notes/shared/types'

const note = (path: string, content: string, mtime = 0): RawNote => ({ path, content, mtime })

// noteLog: ## Log entries

test('appendNoteLogEntry creates the ## Log section and preserves frontmatter', () => {
  const md = '---\ntitle: Canva Deal\ntype: deal\n---\n\nBody paragraph.'
  const out = appendNoteLogEntry(md, {
    date: '2026-07-01',
    actor: 'Ana',
    role: 'sales',
    summary: 'Called the client.',
  })
  assert.match(out, /^---\n/)
  const fm = parseFrontmatter(out)
  assert.equal(fm.title, 'Canva Deal')
  assert.equal(fm.type, 'deal')
  assert.ok(typeof fm.timestamp === 'string' && fm.timestamp.length > 0) // bumped
  assert.match(out, /## Log/)
  assert.match(out, /### 2026-07-01 — Ana \(sales\)\nCalled the client\./)
  assert.ok(out.indexOf('Body paragraph.') < out.indexOf('## Log'))
})

test('appendNoteLogEntry inserts newest-first into an existing ## Log', () => {
  const md = '---\ntitle: Canva Deal\n---\n\nBody.'
  const once = appendNoteLogEntry(md, { date: '2026-07-01', actor: 'Ana', summary: 'First.' })
  const twice = appendNoteLogEntry(once, { date: '2026-07-02', actor: 'Bob', summary: 'Second.' })
  assert.equal(twice.match(/## Log/g)!.length, 1) // section not duplicated
  const first = twice.indexOf('### 2026-07-01 — Ana')
  const second = twice.indexOf('### 2026-07-02 — Bob')
  assert.ok(second !== -1 && first !== -1)
  assert.ok(second < first) // newest on top
})

// noteLog: capture lines

test('formatCaptureEntry/parseCaptureEntries round-trip including refs and tags', () => {
  const at = new Date(2026, 6, 8, 9, 5).getTime()
  const entry = {
    at,
    author: 'Ana',
    text: 'Met  with\nBob about pricing', // whitespace collapses on format
    refs: ['context:deals/canva', 'context:people/bob'],
    tags: ['sales', 'q3'],
  }
  const md = `# July\n\n${formatCaptureEntry(entry)}\n${formatCaptureEntry({ at, author: 'Bob', text: 'Plain line' })}\n`
  const parsed = parseCaptureEntries(md)
  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed[0], {
    when: toDateTimeString(at),
    author: 'Ana',
    text: 'Met with Bob about pricing',
    refs: ['context:deals/canva', 'context:people/bob'],
    tags: ['sales', 'q3'],
  })
  assert.deepEqual(parsed[1].refs, [])
  assert.deepEqual(parsed[1].tags, [])
})

// noteLog: provenance

test('provenanceRef strips .md and stampProvenance merges sources deduped', () => {
  assert.equal(provenanceRef('deals/canva.md'), 'context:deals/canva')
  assert.equal(provenanceRef('deals/canva'), 'context:deals/canva')
  const fm = stampProvenance(
    { title: 'X', sources: ['context:a'] },
    { source: 'context:a', sources: ['context:b', 'context:a'] },
  )
  assert.deepEqual(fm.sources, ['context:a', 'context:b'])
  assert.equal(fm.title, 'X') // rest of frontmatter untouched
})

// linkRewrite

test('rewriteLinks rewrites matching relative + root-absolute links to root-absolute hrefs', () => {
  const body =
    'See [Other](other.md) and [Idx](/index.md) and [Ext](https://e.com) and ' +
    '[Mail](mailto:a@b.c) and [Anchor](#top) and ![img](pic.png) and [Keep](keep.md)'
  const out = rewriteLinks(body, 'portfolio/canva.md', (resolved) => {
    if (resolved === 'portfolio/other.md') return 'archive/other.md'
    if (resolved === 'index.md') return 'root/index.md'
    return null // everything else stays put
  })
  assert.ok(out.includes('[Other](/archive/other.md)')) // relative link, resolved from the note folder
  assert.ok(out.includes('[Idx](/root/index.md)')) // root-absolute link
  assert.ok(out.includes('[Ext](https://e.com)'))
  assert.ok(out.includes('[Mail](mailto:a@b.c)'))
  assert.ok(out.includes('[Anchor](#top)'))
  assert.ok(out.includes('![img](pic.png)')) // images untouched
  assert.ok(out.includes('[Keep](keep.md)')) // map returned null → unchanged
})

// review: individual checks

test('checkBrokenLinks auto-fixes a unique basename match, flags ambiguous ones', () => {
  const metas = buildNoteIndex([
    note('a.md', '---\ntitle: A\n---\n\n[X](missing/target.md) and [D](nowhere/dup.md)'),
    note('stuff/target.md', '---\ntitle: Target\n---\n\nHere.'),
    note('one/dup.md', '---\ntitle: Dup One\n---\n\nHere.'),
    note('two/dup.md', '---\ntitle: Dup Two\n---\n\nHere.'),
  ])
  const { fixes, issues } = checkBrokenLinks(metas)
  assert.deepEqual(fixes, [
    { kind: 'fixBrokenLink', path: 'a.md', from: 'missing/target.md', to: 'stuff/target.md' },
  ])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].kind, 'broken-link')
  assert.match(issues[0].detail, /nowhere\/dup\.md \(ambiguous\)/)
})

test('checkOrphans flags notes with no incoming links', () => {
  const metas = buildNoteIndex([
    note('index.md', '---\ntitle: Index\n---\n\nSee [Canva](portfolio/canva.md)'),
    note('portfolio/canva.md', '---\ntitle: Canva\n---\n\nContent.'),
    note('portfolio/orphan.md', '---\ntitle: Orphan\n---\n\nNobody links me.'),
  ])
  const orphans = checkOrphans(metas).map((i) => i.path)
  assert.ok(orphans.includes('portfolio/orphan.md'))
  assert.ok(!orphans.includes('portfolio/canva.md')) // has a backlink
})

test('checkStaleness flags old notes but skips status: stale / archived', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 1_800_000_000_000
  const metas = buildNoteIndex([
    note('fresh.md', '---\ntitle: Fresh\n---\n\nHi', now - DAY),
    note('old.md', '---\ntitle: Old\n---\n\nHi', now - 200 * DAY),
    note('already-stale.md', '---\ntitle: S\nstatus: stale\n---\n\nHi', now - 400 * DAY),
    note('archived.md', '---\ntitle: A\nstatus: archived\n---\n\nHi', now - 400 * DAY),
  ])
  const fixes = checkStaleness(metas, now, 180)
  assert.deepEqual(fixes, [{ kind: 'setStale', path: 'old.md' }])
})

test('checkSchema fills derivable type/title/timestamp and flags missing description', () => {
  const mtime = Date.UTC(2026, 0, 2)
  const metas = buildNoteIndex([
    note('bare.md', 'Just a body, no frontmatter.', mtime),
    note('full.md', '---\ntitle: Full\ntype: doc\ntimestamp: 2026-01-01T00:00:00Z\ndescription: d\n---\n\nHi', mtime),
  ])
  const { fixes, issues } = checkSchema(metas)
  assert.equal(fixes.length, 1)
  assert.deepEqual(fixes[0], {
    kind: 'addMissingFrontmatter',
    path: 'bare.md',
    fields: { type: 'note', title: 'bare', timestamp: new Date(mtime).toISOString() },
  })
  assert.deepEqual(issues, [{ path: 'bare.md', kind: 'schema', detail: 'missing description' }])
})

// review: applyAutoFix

test('applyAutoFix setStale adds status without disturbing the body', () => {
  const out = applyAutoFix('---\ntitle: T\n---\n\nBody here.', { kind: 'setStale', path: 't.md' })
  const fm = parseFrontmatter(out)
  assert.equal(fm.status, 'stale')
  assert.equal(fm.title, 'T')
  assert.ok(out.includes('Body here.'))
})

test('applyAutoFix addMissingFrontmatter fills gaps but existing values win', () => {
  const out = applyAutoFix('---\ntitle: Kept\n---\n\nBody.', {
    kind: 'addMissingFrontmatter',
    path: 't.md',
    fields: { title: 'Clobbered', type: 'note' },
  })
  const fm = parseFrontmatter(out)
  assert.equal(fm.title, 'Kept') // existing frontmatter wins
  assert.equal(fm.type, 'note') // only the missing field was filled
})

test('applyAutoFix fixBrokenLink rewrites the href to the root-absolute target', () => {
  const out = applyAutoFix('---\ntitle: T\n---\n\nSee [X](missing/target.md).', {
    kind: 'fixBrokenLink',
    path: 't.md',
    from: 'missing/target.md',
    to: 'stuff/target.md',
  })
  assert.ok(out.includes('[X](/stuff/target.md)'))
  assert.ok(!out.includes('missing/target.md'))
  assert.ok(out.includes('title: T')) // frontmatter survives the body rewrite
})

test('applyAutoFix linkMention links the first plain mention', () => {
  const out = applyAutoFix('---\ntitle: T\n---\n\nCanva is great. Canva again.', {
    kind: 'linkMention',
    path: 't.md',
    title: 'Canva',
    targetPath: 'canva.md',
  })
  assert.ok(out.includes('[Canva](/canva.md) is great.'))
  assert.ok(out.includes('Canva again.')) // only the first mention is linked
})

// review: buildReviewReport

test('buildReviewReport frozen() excludes fixes on locked paths (issues remain)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 1_800_000_000_000
  const raws = [
    note('locked/old.md', '---\ntitle: Locked Old\ntype: doc\ntimestamp: x\ndescription: d\n---\n\nHi', now - 400 * DAY),
    note('open/old.md', '---\ntitle: Open Old\ntype: doc\ntimestamp: x\ndescription: d\n---\n\nHi', now - 400 * DAY),
    note('locked/bare.md', 'no frontmatter at all', now),
  ]
  const metas = buildNoteIndex(raws)
  const report = buildReviewReport({
    raws,
    metas,
    now,
    thresholds: DEFAULT_THRESHOLDS,
    mode: 'light',
    frozen: (p) => p.startsWith('locked/'),
  })
  assert.ok(!report.autoFixes.some((f) => f.path.startsWith('locked/')))
  assert.deepEqual(report.autoFixes, [{ kind: 'setStale', path: 'open/old.md' }])
  assert.equal(report.counts.autoFixes, report.autoFixes.length)
  // findings are informational and stay visible even for frozen paths
  assert.ok(report.issues.some((i) => i.path === 'locked/bare.md' && i.kind === 'schema'))
  assert.equal(report.generatedAt, now)
})

test('buildReviewReport full mode adds duplicates and oversized findings', () => {
  const now = 1_800_000_000_000
  const fruitBody = 'apple banana cherry durian elderberry fig grape honeydew kiwi'
  const raws = [
    note('a.md', `---\ntitle: Fruit One\ndescription: d\n---\n\n${fruitBody}`, now),
    note('b.md', `---\ntitle: Fruit Two\ndescription: d\n---\n\n${fruitBody}`, now),
    note('big.md', `---\ntitle: Big\ndescription: d\n---\n\n${'## Section\n\nrecipe filler words '.repeat(10)}`, now),
  ]
  const metas = buildNoteIndex(raws)
  const thresholds = { staleDays: 180, oversizeChars: 100, duplicateSim: 0.65, contradictionSim: 0.35 }

  const light = buildReviewReport({ raws, metas, now, thresholds, mode: 'light' })
  assert.ok(!light.issues.some((i) => i.kind === 'duplicate' || i.kind === 'oversized'))

  const full = buildReviewReport({ raws, metas, now, thresholds, mode: 'full' })
  const dups = full.issues.filter((i) => i.kind === 'duplicate')
  assert.equal(dups.length, 1) // the a/b pair is reported once, not twice
  assert.ok(full.issues.some((i) => i.kind === 'oversized' && i.path === 'big.md'))
})

// enrichment: candidate selection

const sources: EnrichmentSource[] = [
  { path: 'p/a.md', type: 'note', title: 'A', text: 'fresh insight', sha256: 'h-a', mtime: 100 },
  { path: 'p/b.md', title: 'B', text: 'unchanged since last pass', sha256: 'h-b', mtime: 200 },
  { path: 'p/c.md', title: 'C', text: '   \n ', sha256: 'h-c', mtime: 300 }, // empty body
  { path: 'p/d.md', title: 'D', text: 'edited again', sha256: 'h-d2', mtime: 300 },
]
const ledger = { seen: { 'p/b.md': 'h-b', 'p/d.md': 'h-d1' } }

test('selectEnrichmentCandidates skips ledger-unchanged and empty sources', () => {
  const picked = selectEnrichmentCandidates(sources, ledger, { trigger: 'scheduled' })
  assert.deepEqual(picked.map((c) => c.sourcePath), ['p/a.md', 'p/d.md']) // b unchanged, c empty
  assert.equal(picked[0].sha256, 'h-a')
  assert.equal(picked[0].type, 'note')
  // running again after recording the new hashes selects nothing (idempotent)
  const after = { seen: { ...ledger.seen, 'p/a.md': 'h-a', 'p/d.md': 'h-d2' } }
  assert.deepEqual(selectEnrichmentCandidates(sources, after, { trigger: 'scheduled' }), [])
})

test('selectEnrichmentCandidates honors only and since (inclusive) filters', () => {
  const only = selectEnrichmentCandidates(sources, ledger, { trigger: 'on-demand', only: 'p/a.md' })
  assert.deepEqual(only.map((c) => c.sourcePath), ['p/a.md'])
  const since = selectEnrichmentCandidates(sources, ledger, { trigger: 'scheduled', since: 300 })
  assert.deepEqual(since.map((c) => c.sourcePath), ['p/d.md']) // mtime 300 >= 300 kept, 100 dropped
})

// enrichment: output coercion

const ctx = { validTargetIds: new Set(['deals/canva']) }

test('coerceEnrichmentOutput rejects malformed outputs', () => {
  assert.equal(coerceEnrichmentOutput(null, ctx), null)
  assert.equal(coerceEnrichmentOutput('nope', ctx), null)
  assert.equal(coerceEnrichmentOutput({ action: 'delete_all', insight: 'x' }, ctx), null) // bad action
  assert.equal(coerceEnrichmentOutput({ action: 'new_note', insight: '  ', newNote: { title: 'T' } }, ctx), null) // empty insight
  assert.equal(coerceEnrichmentOutput({ hasInsight: false, action: 'new_note', insight: 'x' }, ctx), null)
  assert.equal(coerceEnrichmentOutput({ action: 'append_log', insight: 'x', targetId: 'not/valid' }, ctx), null)
  assert.equal(coerceEnrichmentOutput({ action: 'new_note', insight: 'x', newNote: { type: 't' } }, ctx), null) // no title
})

test('coerceEnrichmentOutput accepts append_log, normalizing a .md target id', () => {
  const out = coerceEnrichmentOutput(
    { action: 'append_log', insight: '  learned a thing  ', targetId: 'deals/canva.md', links: ['a', 7], sources: ['s1'] },
    ctx,
  )
  assert.deepEqual(out, {
    action: 'append_log',
    insight: 'learned a thing',
    targetId: 'deals/canva',
    links: ['a'], // non-strings dropped
    sources: ['s1'],
  })
})

test('coerceEnrichmentOutput accepts new_note incl. legacy new_context, defaulting type', () => {
  const modern = coerceEnrichmentOutput(
    { action: 'new_note', insight: 'i', newNote: { title: ' T ' } },
    ctx,
  )
  assert.deepEqual(modern?.newNote, { type: 'insight', title: 'T' }) // type defaulted
  const legacy = coerceEnrichmentOutput(
    { action: 'new_context', insight: 'i', newContext: { type: 'concept', title: 'T' } },
    ctx,
  )
  assert.equal(legacy?.action, 'new_note')
  assert.deepEqual(legacy?.newNote, { type: 'concept', title: 'T' })
})

// lifecycle: the frontmatter vocabulary

test('statusOf defaults to active and ignores unknown spellings', () => {
  assert.equal(statusOf({}), 'active')
  assert.equal(statusOf({ status: 'Superseded' }), 'superseded') // case-insensitive
  assert.equal(statusOf({ status: 'in-flight' }), 'active') // unknown = current, never silently retired
})

test('expiresAtOf reads a bare date as the END of that day', () => {
  assert.equal(expiresAtOf({ expires: '2026-09-01' }), Date.parse('2026-09-01T23:59:59.999Z'))
  assert.equal(expiresAtOf({ expires: '2026-09-01T09:00:00Z' }), Date.parse('2026-09-01T09:00:00Z'))
  assert.equal(expiresAtOf({ expires: 'whenever' }), null)
  assert.equal(expiresAtOf({}), null)
})

test('note refs normalize regardless of leading slash or .md suffix', () => {
  assert.equal(normalizeNoteRef('/decisions/pricing.md'), 'decisions/pricing.md')
  assert.equal(normalizeNoteRef('decisions/pricing'), 'decisions/pricing.md')
  assert.deepEqual(supersedesOf({ supersedes: '/a.md' }), ['a.md']) // scalar or list
  assert.deepEqual(supersedesOf({ supersedes: ['a', '/a.md', 'b.md'] }), ['a.md', 'b.md']) // deduped
  assert.equal(supersededByOf({ superseded_by: '/new.md' }), 'new.md')
})

// review: expiry

test('checkExpiry retires notes past their own expires date, once', () => {
  const now = Date.parse('2026-08-19T00:00:00Z')
  const metas = buildNoteIndex([
    note('past.md', '---\ntitle: Past\nexpires: 2026-07-01\n---\n\nHi', now),
    note('today.md', '---\ntitle: Today\nexpires: 2026-08-19\n---\n\nHi', now), // end of day = not yet
    note('future.md', '---\ntitle: Future\nexpires: 2027-01-01\n---\n\nHi', now),
    note('done.md', '---\ntitle: Done\nexpires: 2026-07-01\nstatus: expired\n---\n\nHi', now),
    note('none.md', '---\ntitle: None\n---\n\nHi', now),
  ])
  assert.deepEqual(checkExpiry(metas, now), [{ kind: 'setExpired', path: 'past.md' }])
})

test('checkStaleness leaves already-retired notes alone', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 1_800_000_000_000
  const metas = buildNoteIndex([
    note('superseded.md', '---\ntitle: S\nstatus: superseded\n---\n\nHi', now - 400 * DAY),
    note('expired.md', '---\ntitle: E\nstatus: expired\n---\n\nHi', now - 400 * DAY),
    note('plain.md', '---\ntitle: P\n---\n\nHi', now - 400 * DAY),
  ])
  assert.deepEqual(checkStaleness(metas, now, 180), [{ kind: 'setStale', path: 'plain.md' }])
})

// review: supersession integrity

test('checkSupersession records the back-pointer on the replaced note', () => {
  const metas = buildNoteIndex([
    note('new.md', '---\ntitle: New\nsupersedes: /old.md\n---\n\nHi'),
    note('old.md', '---\ntitle: Old\n---\n\nHi'),
  ])
  const { fixes, issues } = checkSupersession(metas)
  assert.deepEqual(fixes, [{ kind: 'linkSupersession', path: 'old.md', byPath: 'new.md' }])
  assert.deepEqual(issues, [])
})

test('checkSupersession resolves a bare ref by basename and stops once recorded', () => {
  const metas = buildNoteIndex([
    note('d/new.md', '---\ntitle: New\nsupersedes: pricing\n---\n\nHi'),
    note('d/pricing.md', '---\ntitle: Pricing\nstatus: superseded\nsuperseded_by: /d/pricing-new\n---\n\nHi'),
  ])
  // The back-pointer above resolves to nothing, so the pass still has work to do;
  // the point here is that `supersedes: pricing` found d/pricing.md by basename.
  const { fixes } = checkSupersession(metas)
  assert.deepEqual(fixes, [{ kind: 'linkSupersession', path: 'd/pricing.md', byPath: 'd/new.md' }])
})

test('checkSupersession is idempotent once the back-pointer is recorded', () => {
  const metas = buildNoteIndex([
    note('new.md', '---\ntitle: New\nsupersedes: /old.md\n---\n\nHi'),
    note('old.md', '---\ntitle: Old\nstatus: superseded\nsuperseded_by: /new.md\n---\n\nHi'),
  ])
  const { fixes, issues } = checkSupersession(metas)
  assert.deepEqual(fixes, [])
  assert.deepEqual(issues, [])
})

test('checkSupersession reports unresolvable, self- and mutual supersession', () => {
  const metas = buildNoteIndex([
    note('ghost.md', '---\ntitle: Ghost\nsupersedes: /nope.md\n---\n\nHi'),
    note('self.md', '---\ntitle: Self\nsupersedes: /self.md\n---\n\nHi'),
    note('a.md', '---\ntitle: A\nsupersedes: /b.md\n---\n\nHi'),
    note('b.md', '---\ntitle: B\nsupersedes: /a.md\n---\n\nHi'),
    note('orphaned.md', '---\ntitle: O\nsuperseded_by: /gone.md\n---\n\nHi'),
  ])
  const { fixes, issues } = checkSupersession(metas)
  assert.deepEqual(fixes, []) // nothing here is safe to fix mechanically
  const detail = (path: string) => issues.find((i) => i.path === path)?.detail ?? ''
  assert.match(detail('ghost.md'), /matches no note/)
  assert.match(detail('self.md'), /supersedes itself/)
  assert.equal(issues.filter((i) => /mutually supersedes/.test(i.detail)).length, 1) // reported once
  assert.match(detail('orphaned.md'), /superseded_by .* matches no note/)
})

// review: applyAutoFix for the lifecycle fixes

test('applyAutoFix setExpired and linkSupersession stamp frontmatter only', () => {
  const expired = applyAutoFix('---\ntitle: T\nexpires: 2026-01-01\n---\n\nBody.', {
    kind: 'setExpired',
    path: 't.md',
  })
  assert.equal(parseFrontmatter(expired).status, 'expired')
  assert.ok(expired.includes('Body.'))

  const linked = applyAutoFix('---\ntitle: Old\n---\n\nBody.', {
    kind: 'linkSupersession',
    path: 'old.md',
    byPath: 'decisions/new.md',
  })
  const fm = parseFrontmatter(linked)
  assert.equal(fm.status, 'superseded')
  assert.equal(fm.superseded_by, '/decisions/new.md') // leading slash: clickable as a link
  assert.ok(linked.includes('Body.'))
})

// review: contradictions

const contradictionInput = (raws: RawNote[]) => {
  const metas = buildNoteIndex(raws)
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  const docs = metas.map((m) => ({ path: m.path, title: m.title, body: bodyByPath.get(m.path) ?? '' }))
  return { metas, bodyByPath, pairs: nearPairs(docs, 0.1, 3) }
}

test('extractClaims keys lines by their opening topic words and skips code fences', () => {
  const claims = extractClaims(
    'The onboarding trial period lasts 14 days for new spaces.\n\n```\ntrial = 30 days in this config sample\n```\n\ntiny\n',
  )
  assert.equal(claims.length, 1)
  assert.equal(claims[0].key, 'onboarding trial period lasts')
  assert.ok(claims[0].numbers.includes('14'))
})

test('checkContradictions catches divergent numbers between related notes', () => {
  const { metas, bodyByPath, pairs } = contradictionInput([
    note('a.md', '---\ntitle: Trial Policy\ndescription: d\n---\n\nThe onboarding trial period lasts 14 days for new spaces.'),
    note('b.md', '---\ntitle: Trial Rules\ndescription: d\n---\n\nThe onboarding trial period lasts 30 days for new spaces.'),
  ])
  const issues = checkContradictions(pairs, metas, bodyByPath, 0.1)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].kind, 'contradiction')
  assert.match(issues[0].detail, /14 days/)
  assert.match(issues[0].detail, /30 days/)
})

test('checkContradictions catches an opposite claim and a divergent frontmatter field', () => {
  const { metas, bodyByPath, pairs } = contradictionInput([
    note('a.md', '---\ntitle: Billing Policy\ndescription: d\nowner: ana\n---\n\nSpaces on the free plan support connector webhooks today.'),
    note('b.md', '---\ntitle: Billing Notes\ndescription: d\nowner: sam\n---\n\nSpaces on the free plan cannot support connector webhooks today.'),
  ])
  const issues = checkContradictions(pairs, metas, bodyByPath, 0.1)
  assert.equal(issues.length, 1)
  assert.match(issues[0].detail, /owner: "ana" vs "sam"/)
})

test('checkContradictions stays quiet on agreement, declared supersession and retired notes', () => {
  const agree = contradictionInput([
    note('a.md', '---\ntitle: Trial Policy\ndescription: d\n---\n\nThe onboarding trial period lasts 14 days for new spaces.'),
    note('b.md', '---\ntitle: Trial Rules\ndescription: d\n---\n\nThe onboarding trial period lasts 14 days for new spaces.'),
  ])
  assert.deepEqual(checkContradictions(agree.pairs, agree.metas, agree.bodyByPath, 0.1), [])

  const settled = contradictionInput([
    note('a.md', '---\ntitle: Trial Policy\ndescription: d\nsupersedes: /b.md\n---\n\nThe onboarding trial period lasts 14 days for new spaces.'),
    note('b.md', '---\ntitle: Trial Rules\ndescription: d\n---\n\nThe onboarding trial period lasts 30 days for new spaces.'),
  ])
  assert.deepEqual(checkContradictions(settled.pairs, settled.metas, settled.bodyByPath, 0.1), [])

  const retired = contradictionInput([
    note('a.md', '---\ntitle: Trial Policy\ndescription: d\n---\n\nThe onboarding trial period lasts 14 days for new spaces.'),
    note('b.md', '---\ntitle: Trial Rules\ndescription: d\nstatus: archived\n---\n\nThe onboarding trial period lasts 30 days for new spaces.'),
  ])
  assert.deepEqual(checkContradictions(retired.pairs, retired.metas, retired.bodyByPath, 0.1), [])
})

test('buildReviewReport runs supersession in light mode and contradictions only in full', () => {
  const now = 1_800_000_000_000
  const raws = [
    note('new.md', '---\ntitle: Trial Policy\ntype: doc\ntimestamp: x\ndescription: d\nsupersedes: /gone.md\n---\n\nThe onboarding trial period lasts 14 days for new spaces.', now),
    note('other.md', '---\ntitle: Trial Rules\ntype: doc\ntimestamp: x\ndescription: d\n---\n\nThe onboarding trial period lasts 30 days for new spaces.', now),
  ]
  const metas = buildNoteIndex(raws)
  const light = buildReviewReport({ raws, metas, now, thresholds: DEFAULT_THRESHOLDS, mode: 'light' })
  assert.ok(light.issues.some((i) => i.kind === 'supersession')) // exact check, always on
  assert.ok(!light.issues.some((i) => i.kind === 'contradiction'))

  const full = buildReviewReport({ raws, metas, now, thresholds: DEFAULT_THRESHOLDS, mode: 'full' })
  assert.ok(full.issues.some((i) => i.kind === 'contradiction'))
})

test('checkLifecycleFields flags values the system does not understand', () => {
  const metas = buildNoteIndex([
    note('typo.md', '---\ntitle: T\nstatus: superceded\n---\n\nHi'), // misspelled: silently reads as active
    note('conf.md', '---\ntitle: C\nconfidence: pretty-sure\n---\n\nHi'),
    note('when.md', '---\ntitle: W\nexpires: end of quarter\n---\n\nHi'),
    note('fine.md', '---\ntitle: F\nstatus: accepted\nconfidence: likely\nexpires: 2027-01-01\n---\n\nHi'),
  ])
  const issues = checkLifecycleFields(metas)
  assert.deepEqual(
    issues.map((i) => i.path),
    ['typo.md', 'conf.md', 'when.md'],
  )
  assert.ok(issues.every((i) => i.kind === 'lifecycle'))
  assert.match(issues[0].detail, /reads as active/)
})
