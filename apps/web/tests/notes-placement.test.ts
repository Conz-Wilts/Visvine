// Placed folders (lib/notes/shared/placedFolders.ts): what is placed rather
// than moved, where it may go, how a placement is read off index notes and
// drawn into the tree — the pure rules the sidebar and the place route share.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/notes-placement.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPlacements,
  canPlaceInto,
  drawnParentOf,
  holdsOf,
  placeableOf,
  placementDenial,
  placementsFrom,
  structuralIconOf,
  isPeopleFolder,
  withHolds,
} from '../lib/notes/shared/placedFolders'
import { parseFrontmatter } from '../lib/notes/shared/markdown'
import { graftSubspace, SUBSPACE_FOLDER } from '../lib/spaces/subspaces'
import type { NoteMeta, TreeNode } from '../lib/notes/shared/types'

const folder = (path: string, children: TreeNode[] = [], extra: Partial<TreeNode> = {}): TreeNode => ({
  name: path.split('/').pop() ?? path,
  path,
  kind: 'folder',
  children,
  ...extra,
})
const note = (path: string): TreeNode => ({ name: path.split('/').pop() ?? path, path, kind: 'note' })
const meta = (path: string, frontmatter: Record<string, unknown> = {}): NoteMeta => ({
  path,
  title: path,
  folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
  frontmatter,
  tags: [],
  linkTargets: [],
  unresolved: [],
  mtime: 0,
})

/** A space with its built-ins, a custom folder and one flowing room. */
function tree(): TreeNode {
  const root = folder('', [
    folder('people', [folder('people/craig', [note('people/craig/index.md')])]),
    folder('events'),
    folder('channels'),
    folder('ops', [note('ops/index.md'), folder('ops/deep', [note('ops/deep/index.md')])]),
    folder('parent', [folder('parent/channels')], { space: 'hq', parent: true }),
  ])
  graftSubspace(root, { id: 'dp', name: 'Design Partners' }, folder('', [note('index.md'), folder('events'), folder('ops', [note('ops/index.md')])]), true)
  return root
}

describe('placeableOf — what is placed rather than moved', () => {
  it('names the built-in folders, the Sub-spaces folder and a room as placed', () => {
    assert.deepEqual(placeableOf('events'), { space: null, folder: 'events' })
    assert.deepEqual(placeableOf('people'), { space: null, folder: 'people' })
    assert.deepEqual(placeableOf(SUBSPACE_FOLDER), { space: null, folder: SUBSPACE_FOLDER })
    assert.deepEqual(placeableOf('subspaces/dp'), { space: null, folder: 'subspaces/dp' })
  })
  it("a room's own built-in folder is placed in the room", () => {
    assert.deepEqual(placeableOf('subspaces/dp/events'), { space: 'dp', folder: 'events' })
    assert.equal(placeableOf('subspaces/dp/events/x'), null)
    assert.equal(placeableOf('subspaces/dp/ops'), null)
  })
  it('everything else moves by path', () => {
    assert.equal(placeableOf(''), null)
    assert.equal(placeableOf('ops'), null)
    assert.equal(placeableOf('events/x'), null)
    assert.equal(placeableOf('people/craig'), null)
    assert.equal(placeableOf('parent'), null)
    assert.equal(placeableOf('parent/channels'), null)
    assert.equal(placeableOf('events-archive'), null)
  })
})

describe('placementDenial — where a placed folder may go', () => {
  const t = tree()
  it('a folder of the space’s own, or the top', () => {
    assert.equal(placementDenial('events', 'ops', t), null)
    assert.equal(placementDenial('events', 'ops/deep', t), null)
    assert.equal(placementDenial('events', '', t), null)
    assert.equal(placementDenial('subspaces/dp', 'ops', t), null)
    assert.equal(placementDenial(SUBSPACE_FOLDER, 'ops', t), null)
  })
  it('never inside another built-in folder, an entity’s folder, or what the parent shares', () => {
    assert.match(placementDenial('events', 'people', t) ?? '', /built-in/)
    assert.match(placementDenial('events', 'people/craig', t) ?? '', /built-in/)
    assert.match(placementDenial('events', SUBSPACE_FOLDER, t) ?? '', /built-in/)
    assert.match(placementDenial('events', 'parent', t) ?? '', /read-only/)
    assert.match(placementDenial('events', 'parent/channels', t) ?? '', /read-only/)
  })
  it('never across the wall', () => {
    assert.match(placementDenial('subspaces/dp/events', 'ops', t) ?? '', /own space/)
    assert.match(placementDenial('subspaces/dp/events', '', t) ?? '', /own space/)
    assert.match(placementDenial('events', 'subspaces/dp/ops', t) ?? '', /own space/)
    assert.match(placementDenial('events', 'subspaces/dp', t) ?? '', /own space/)
    assert.match(placementDenial('subspaces/dp', 'subspaces/dp/ops', t) ?? '', /own space/)
  })
  it("a room's own folder goes in a folder of the room, or the room's top", () => {
    assert.equal(placementDenial('subspaces/dp/events', 'subspaces/dp/ops', t), null)
    assert.equal(placementDenial('subspaces/dp/events', 'subspaces/dp', t), null)
  })
  it('a room sits in Sub-spaces or in a folder of your own — never the bare top', () => {
    assert.equal(placementDenial('subspaces/dp', SUBSPACE_FOLDER, t), null)
    assert.match(placementDenial('subspaces/dp', '', t) ?? '', /Sub-spaces/)
  })
  it('never inside itself, by path or by drawing', () => {
    assert.match(placementDenial('events', 'events', t) ?? '', /inside itself/)
    assert.match(placementDenial(SUBSPACE_FOLDER, 'subspaces/dp', t) ?? '', /own space|inside itself/)
    // ops is drawn under events; events cannot then go into ops/deep.
    const drawn = tree()
    applyPlacements(drawn, new Map([['events', 'ops']]))
    assert.equal(drawnParentOf(drawn, 'events'), 'ops')
    const cyc = tree()
    // Put ops (by drawing) under events: simulate a custom folder drawn inside a placed one.
    const events = cyc.children!.find((c) => c.path === 'events')!
    const ops = cyc.children!.find((c) => c.path === 'ops')!
    cyc.children = cyc.children!.filter((c) => c !== ops)
    events.children!.push(ops)
    assert.match(placementDenial('events', 'ops/deep', cyc) ?? '', /inside itself/)
    assert.equal(placementDenial('events', 'ops/deep'), null) // without the tree, the path rules alone
  })
  it('only a placed folder is placed', () => {
    assert.match(placementDenial('ops', '', t) ?? '', /moved, not placed/)
  })
})

describe('canPlaceInto — legal AND a change', () => {
  it('refuses the folder it is already drawn in', () => {
    const t = tree()
    assert.equal(canPlaceInto(t, 'events', ''), false)
    assert.equal(canPlaceInto(t, 'events', 'ops'), true)
    assert.equal(canPlaceInto(t, 'subspaces/dp', SUBSPACE_FOLDER), false)
    assert.equal(canPlaceInto(t, 'subspaces/dp', 'ops'), true)
    applyPlacements(t, new Map([['events', 'ops']]))
    assert.equal(canPlaceInto(t, 'events', 'ops'), false)
    assert.equal(canPlaceInto(t, 'events', ''), true)
  })
})

describe('placementsFrom — read off the index notes', () => {
  it('collects holds: from every folder index, root-relative', () => {
    const map = placementsFrom([
      meta('index.md', { holds: ['events'] }), // the root holds by default: ignored
      meta('ops/index.md', { holds: ['events', 'subspaces/dp', 'nope', 'people/craig'] }),
      meta('ops/deep/index.md', { holds: ['channels'] }),
      meta('people/craig/index.md', { type: 'Person' }),
    ])
    assert.deepEqual(
      [...map].sort(([a], [b]) => a.localeCompare(b)),
      [['channels', 'ops/deep'], ['events', 'ops'], ['subspaces/dp', 'ops']],
    )
  })
  it('two folders claiming one: the smaller path wins', () => {
    const map = placementsFrom([meta('zeta/index.md', { holds: ['events'] }), meta('alpha/index.md', { holds: ['events'] })])
    assert.equal(map.get('events'), 'alpha')
  })
  it('a room held by the Sub-spaces folder is where it sits anyway', () => {
    const map = placementsFrom([meta('subspaces/index.md', { holds: ['subspaces/dp'] })])
    assert.equal(map.size, 0)
  })
  it('holds: must be a list of strings', () => {
    assert.deepEqual(holdsOf({ holds: 'events' }), [])
    assert.deepEqual(holdsOf({ holds: ['events', 3, ' ', 'people'] }), ['events', 'people'])
    assert.deepEqual(holdsOf(undefined), [])
  })
})

describe('applyPlacements — the drawing', () => {
  it('moves each placed node under its container and nothing else', () => {
    const t = tree()
    applyPlacements(t, new Map([['events', 'ops'], ['subspaces/dp', 'ops/deep'], [SUBSPACE_FOLDER, 'ops']]))
    assert.equal(drawnParentOf(t, 'events'), 'ops')
    assert.equal(drawnParentOf(t, 'subspaces/dp'), 'ops/deep')
    assert.equal(drawnParentOf(t, SUBSPACE_FOLDER), 'ops')
    assert.equal(drawnParentOf(t, 'people'), '')
    // The paths are what they were.
    const events = t.children!.find((c) => c.path === 'ops')!.children!.find((c) => c.path === 'events')
    assert.equal(events?.path, 'events')
  })
  it('skips a placement it cannot honour: missing container, a built-in container, a cycle', () => {
    const t = tree()
    applyPlacements(t, new Map([['events', 'gone'], ['channels', 'people'], ['people', 'people/craig']]))
    assert.equal(drawnParentOf(t, 'events'), '')
    assert.equal(drawnParentOf(t, 'channels'), '')
    assert.equal(drawnParentOf(t, 'people'), '')
  })
  it('is idempotent', () => {
    const t = tree()
    const map = new Map([['events', 'ops']])
    applyPlacements(t, map)
    const once = JSON.stringify(t)
    applyPlacements(t, map)
    assert.equal(JSON.stringify(t), once)
  })
  it("a room's own placements, rebased into the parent, are drawn inside the room", () => {
    const t = tree()
    applyPlacements(t, new Map([['subspaces/dp/events', 'subspaces/dp/ops']]))
    assert.equal(drawnParentOf(t, 'subspaces/dp/events'), 'subspaces/dp/ops')
  })
})

describe('withHolds — the frontmatter patch', () => {
  it('sets, replaces and removes the key, leaving the body alone', () => {
    const src = '---\ntitle: Ops\ntags: [a]\n---\n\nProse.\n\n<!-- index:children -->\n<!-- /index:children -->\n'
    const set = withHolds(src, ['events'])
    assert.deepEqual(parseFrontmatter(set).holds, ['events'])
    assert.equal(parseFrontmatter(set).title, 'Ops')
    assert.match(set, /Prose\.\n\n<!-- index:children -->/)
    const cleared = withHolds(set, [])
    assert.equal(parseFrontmatter(cleared).holds, undefined)
    assert.equal(parseFrontmatter(cleared).title, 'Ops')
  })
})

describe('structuralIconOf — the glyph', () => {
  it('a built-in folder wears its tool’s glyph, a room and a plain folder none', () => {
    assert.equal(structuralIconOf('events'), 'nav-events')
    assert.equal(structuralIconOf('people'), 'nav-directory')
    assert.equal(structuralIconOf(SUBSPACE_FOLDER), 'space')
    // A room takes the plain folder glyph: the tier it is drawn in already
    // says it is another space (lib/notes/shared/rootTiers.ts).
    assert.equal(structuralIconOf('subspaces/dp'), null)
    assert.equal(structuralIconOf('subspaces/dp/events'), 'nav-events')
    assert.equal(structuralIconOf('parent'), 'space')
    assert.equal(structuralIconOf('ops'), null)
    assert.equal(isPeopleFolder('people'), true)
    assert.equal(isPeopleFolder('subspaces/dp/people'), true)
    assert.equal(isPeopleFolder('people/connor'), false)
    assert.equal(isPeopleFolder('events'), false)
    assert.equal(structuralIconOf('events/x'), null)
  })
})
