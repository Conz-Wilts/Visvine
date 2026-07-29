// Unit tests for the brain maintenance layer: ## Log stamping + capture lines
// (noteLog), link rewriting on moves (linkRewrite), the review agent's pure
// checks/auto-fixes (review), and enrichment candidate selection + LLM output
// coercion (enrichment). Fixtures go through the real index pipeline
// (buildNoteIndex). Run: node --import tsx --test tests/brain-maintenance.test.ts
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
  checkOrphans,
  checkSchema,
  checkStaleness,
  DEFAULT_THRESHOLDS,
} from '../lib/notes/shared/review'
import {
  coerceEnrichmentOutput,
  selectEnrichmentCandidates,
  type EnrichmentSource,
} from '../lib/notes/shared/enrichment'
import { buildNoteIndex } from '../lib/notes/shared/context'
import { parseFrontmatter } from '../lib/notes/shared/markdown'
import type { RawNote } from '../lib/notes/shared/types'

const note = (path: string, content: string, mtime = 0): RawNote => ({ path, content, mtime })

// --- noteLog: ## Log entries -----------------------------------------------------

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

// --- noteLog: capture lines --------------------------------------------------------

test('formatCaptureEntry/parseCaptureEntries round-trip including refs and tags', () => {
  const at = new Date(2026, 6, 8, 9, 5).getTime()
  const entry = {
    at,
    author: 'Ana',
    text: 'Met  with\nBob about pricing', // whitespace collapses on format
    refs: ['brain:deals/canva', 'brain:people/bob'],
    tags: ['sales', 'q3'],
  }
  const md = `# July\n\n${formatCaptureEntry(entry)}\n${formatCaptureEntry({ at, author: 'Bob', text: 'Plain line' })}\n`
  const parsed = parseCaptureEntries(md)
  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed[0], {
    when: toDateTimeString(at),
    author: 'Ana',
    text: 'Met with Bob about pricing',
    refs: ['brain:deals/canva', 'brain:people/bob'],
    tags: ['sales', 'q3'],
  })
  assert.deepEqual(parsed[1].refs, [])
  assert.deepEqual(parsed[1].tags, [])
})

// --- noteLog: provenance ------------------------------------------------------------

test('provenanceRef strips .md and stampProvenance merges sources deduped', () => {
  assert.equal(provenanceRef('deals/canva.md'), 'brain:deals/canva')
  assert.equal(provenanceRef('deals/canva'), 'brain:deals/canva')
  const fm = stampProvenance(
    { title: 'X', sources: ['brain:a'] },
    { source: 'brain:a', sources: ['brain:b', 'brain:a'] },
  )
  assert.deepEqual(fm.sources, ['brain:a', 'brain:b'])
  assert.equal(fm.title, 'X') // rest of frontmatter untouched
})

// --- linkRewrite ---------------------------------------------------------------------

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

// --- review: individual checks --------------------------------------------------------

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

// --- review: applyAutoFix ---------------------------------------------------------------

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

// --- review: buildReviewReport ------------------------------------------------------------

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
  const thresholds = { staleDays: 180, oversizeChars: 100, duplicateSim: 0.65 }

  const light = buildReviewReport({ raws, metas, now, thresholds, mode: 'light' })
  assert.ok(!light.issues.some((i) => i.kind === 'duplicate' || i.kind === 'oversized'))

  const full = buildReviewReport({ raws, metas, now, thresholds, mode: 'full' })
  const dups = full.issues.filter((i) => i.kind === 'duplicate')
  assert.equal(dups.length, 1) // the a/b pair is reported once, not twice
  assert.ok(full.issues.some((i) => i.kind === 'oversized' && i.path === 'big.md'))
})

// --- enrichment: candidate selection ---------------------------------------------------------

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

// --- enrichment: output coercion --------------------------------------------------------------

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
