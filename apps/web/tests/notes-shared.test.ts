// Unit tests for the reused note pure-logic layer (ported from blackbird-brain
// into lib/notes/shared). These lock the index/graph/backlink/related/search/
// merge behavior the whole notes feature is built on. Run with the repo's node
// test runner: node --import tsx --test tests/notes-shared.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  splitFrontmatter,
  parseFrontmatter,
  joinFrontmatter,
  extractMarkdownLinks,
  extractHashtags,
  resolveOkfLink,
} from '../lib/notes/shared/markdown'
import { buildNoteIndex, buildTree, buildGraph, filterGraph } from '../lib/notes/shared/graph'
import { computeReferences, linkFirstMention } from '../lib/notes/shared/references'
import { relatedNotes } from '../lib/notes/shared/related'
import { searchNotes } from '../lib/notes/shared/search'
import { collectTags, linkInsights } from '../lib/notes/shared/insights'
import { decideMerge } from '../lib/notes/shared/merge'
import { coerceMoves } from '../lib/notes/shared/reorganize'
import type { RawNote } from '../lib/notes/shared/types'

const note = (path: string, content: string, mtime = 0): RawNote => ({ path, content, mtime })

// --- markdown ----------------------------------------------------------------

test('splitFrontmatter separates YAML from body', () => {
  const { frontmatter, body } = splitFrontmatter('---\ntitle: A\n---\n\nHello')
  assert.equal(frontmatter, 'title: A')
  assert.equal(body, 'Hello')
  assert.equal(splitFrontmatter('No frontmatter').frontmatter, null)
})

test('parse/join frontmatter round-trips tags', () => {
  const fm = parseFrontmatter('---\ntitle: A\ntags:\n  - x\n  - y\n---\n\nBody')
  assert.deepEqual(fm.tags, ['x', 'y'])
  const joined = joinFrontmatter({ title: 'A' }, 'Body')
  assert.match(joined, /title: A/)
  assert.match(joined, /Body/)
})

test('extractMarkdownLinks keeps internal links, drops external + images', () => {
  const links = extractMarkdownLinks('[a](b.md) [x](https://e.com) [m](mailto:a@b.c) ![i](p.png) [c](sub/c.md)')
  assert.deepEqual(links, ['b.md', 'sub/c.md'])
})

test('resolveOkfLink handles relative, absolute and ..', () => {
  assert.equal(resolveOkfLink('other.md', 'portfolio/canva.md'), 'portfolio/other.md')
  assert.equal(resolveOkfLink('/index.md', 'portfolio/canva.md'), 'index.md')
  assert.equal(resolveOkfLink('../index.md', 'portfolio/canva.md'), 'index.md')
})

test('extractHashtags dedupes and skips headings / #123', () => {
  assert.deepEqual(extractHashtags('#alpha and #beta and #alpha\n# Heading\n#123'), ['alpha', 'beta'])
})

// --- graph -------------------------------------------------------------------

const vault = (): RawNote[] => [
  note('index.md', '---\ntitle: Index\ntags: [home]\n---\n\nSee [Canva](portfolio/canva.md) and [Gone](portfolio/missing.md)'),
  note('portfolio/canva.md', '---\ntitle: Canva\ntags: [portfolio]\n---\n\nBack to [Index](/index.md) #design'),
  note('portfolio/orphan.md', '---\ntitle: Orphan\n---\n\nNobody links me.'),
]

test('buildNoteIndex resolves links, flags unresolved, merges tags', () => {
  const idx = buildNoteIndex(vault())
  const index = idx.find((m) => m.path === 'index.md')!
  assert.deepEqual(index.linkTargets, ['portfolio/canva.md'])
  assert.deepEqual(index.unresolved, ['portfolio/missing.md'])
  const canva = idx.find((m) => m.path === 'portfolio/canva.md')!
  assert.deepEqual(canva.linkTargets, ['index.md'])
  assert.deepEqual(canva.tags.sort(), ['design', 'portfolio'])
  assert.equal(canva.folder, 'portfolio')
})

test('buildTree nests folders then notes', () => {
  const tree = buildTree(buildNoteIndex(vault()))
  const folder = tree.children!.find((c) => c.kind === 'folder' && c.path === 'portfolio')!
  assert.ok(folder)
  assert.ok(folder.children!.some((c) => c.path === 'portfolio/canva.md'))
  assert.ok(tree.children!.some((c) => c.kind === 'note' && c.path === 'index.md'))
})

test('buildGraph counts degree and filterGraph narrows by focus depth', () => {
  const idx = buildNoteIndex(vault())
  const graph = buildGraph(idx)
  assert.equal(graph.nodes.length, 3)
  assert.equal(graph.links.length, 2) // index→canva and canva→index both resolve (one directed edge each)
  const canva = graph.nodes.find((n) => n.id === 'portfolio/canva.md')!
  assert.ok(canva.degree >= 1)
  const focused = filterGraph(graph, { focus: 'index.md', depth: 1 })
  assert.ok(focused.nodes.some((n) => n.id === 'portfolio/canva.md'))
  assert.ok(!focused.nodes.some((n) => n.id === 'portfolio/orphan.md'))
})

// --- references --------------------------------------------------------------

test('computeReferences finds linked + unlinked mentions', () => {
  const notes = [
    note('canva.md', '---\ntitle: Canva\n---\n\nThe design tool.'),
    note('a.md', '---\ntitle: A\n---\n\nI use [Canva](canva.md) daily.'),
    note('b.md', '---\ntitle: B\n---\n\nCanva is great but I have not linked it.'),
  ]
  const refs = computeReferences(notes, 'canva.md', buildNoteIndex(notes))
  assert.equal(refs.linked.length, 1)
  assert.equal(refs.linked[0].fromPath, 'a.md')
  assert.equal(refs.unlinked.length, 1)
  assert.equal(refs.unlinked[0].fromPath, 'b.md')
})

test('computeReferences excerpts strip markdown and scope list items to their line', () => {
  const notes = [
    note('canva.md', '---\ntitle: Canva\n---\n\nThe design tool.'),
    note(
      'list.md',
      '---\ntitle: List\n---\n\n## Portfolio (2)\n- [Canva](canva.md) — Active · **Series F**\n- [Other](other.md) — Exited',
    ),
    note('heading.md', '---\ntitle: Heading\n---\n\n## About [Canva](canva.md) and `tools`\n\nBody.'),
    note('quote.md', '---\ntitle: Quote\n---\n\n> Canva is *great* and I have not linked it.'),
  ]
  const refs = computeReferences(notes, 'canva.md', buildNoteIndex(notes))
  const fromList = refs.linked.find((r) => r.fromPath === 'list.md')!
  // Just the list item's own line — not the heading or sibling items — with the
  // bullet, link syntax, and bold markers stripped.
  assert.equal(fromList.excerpt, 'Canva — Active · Series F')
  const fromHeading = refs.linked.find((r) => r.fromPath === 'heading.md')!
  assert.equal(fromHeading.excerpt, 'About Canva and tools')
  const fromQuote = refs.unlinked.find((r) => r.fromPath === 'quote.md')!
  assert.equal(fromQuote.excerpt, 'Canva is great and I have not linked it.')
})

test('linkFirstMention turns a plain mention into a link', () => {
  const out = linkFirstMention('I love Canva a lot.', 'Canva', 'canva.md')
  assert.equal(out, 'I love [Canva](/canva.md) a lot.')
  assert.equal(linkFirstMention('No mention here', 'Canva', 'canva.md'), null)
})

// --- related -----------------------------------------------------------------

test('relatedNotes ranks similar notes and respects exclude', () => {
  const docs = [
    { path: 'a.md', title: 'Design systems', body: 'design tokens components design system patterns' },
    { path: 'b.md', title: 'Design tokens', body: 'tokens design components color spacing system' },
    { path: 'c.md', title: 'Cooking', body: 'recipes pasta tomato basil garlic onion' },
  ]
  const res = relatedNotes(docs, 'a.md', { limit: 5 })
  assert.equal(res[0].path, 'b.md')
  assert.ok(!res.some((r) => r.path === 'a.md'))
  const excluded = relatedNotes(docs, 'a.md', { exclude: new Set(['b.md']) })
  assert.ok(!excluded.some((r) => r.path === 'b.md'))
})

// --- search ------------------------------------------------------------------

test('searchNotes uses AND semantics and returns snippets', () => {
  const docs = [
    { path: 'a.md', title: 'Alpha', body: 'the quick brown fox jumps' },
    { path: 'b.md', title: 'Beta', body: 'quick notes only' },
  ]
  const res = searchNotes(docs, 'quick brown')
  assert.equal(res.length, 1)
  assert.equal(res[0].path, 'a.md')
  assert.ok(res[0].snippet.includes('quick'))
  assert.equal(searchNotes(docs, '').length, 0)
})

// --- insights ----------------------------------------------------------------

test('collectTags counts and linkInsights finds orphans + hubs', () => {
  const idx = buildNoteIndex(vault())
  const tags = collectTags(idx)
  assert.ok(tags.some((t) => t.tag === 'portfolio' && t.count === 1))
  const ins = linkInsights(idx)
  assert.ok(ins.orphans.some((o) => o.path === 'portfolio/orphan.md'))
  assert.ok(ins.hubs.length >= 1)
})

// --- merge -------------------------------------------------------------------

test('decideMerge resolves the four cases', () => {
  assert.equal(decideMerge('base', 'same', 'same').status, 'in-sync')
  assert.equal(decideMerge('base', 'mine', 'base').status, 'up-to-date')
  assert.equal(decideMerge('base', 'base', 'theirs').status, 'fast-forward')
  assert.equal(decideMerge('base', 'mine', 'theirs').status, 'conflict')
})

// --- reorganize --------------------------------------------------------------

test('coerceMoves rejects unsafe / hallucinated moves', () => {
  const existing = new Set(['a.md', 'b.md'])
  const moves = coerceMoves(
    [
      { from: 'a.md', to: 'folder/a.md', reason: 'group' }, // valid
      { from: 'ghost.md', to: 'x.md', reason: 'no source' }, // source missing
      { from: 'b.md', to: 'b.txt', reason: 'bad ext' }, // not .md
      { from: 'b.md', to: '../escape.md', reason: 'traversal' }, // .. rejected
      { from: 'a.md', to: 'b.md', reason: 'collision' }, // collides with existing
    ],
    existing,
  )
  assert.equal(moves.length, 1)
  assert.equal(moves[0].to, 'folder/a.md')
})
