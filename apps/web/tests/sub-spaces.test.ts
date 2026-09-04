// The pure rules of sub-spaces (lib/spaces/subspaces.ts) and the one piece of
// the read-through that is pure: link rebasing (lib/notes/federation.ts).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUBSPACE_FOLDER,
  flowsUp,
  graftSubspace,
  isSubspacePath,
  spaceBranches,
  spaceMark,
  parentDenial,
  parseSubspacePath,
  rebaseMeta,
  rebaseNoteLinks,
  rebasePath,
  spaceTrail,
  subspaceFolderPath,
  subspaceWriteDenial,
} from '../lib/spaces/subspaces'
import type { TreeNode } from '../lib/notes/shared/types'

describe('parentDenial — one level deep', () => {
  it('a top-level space may hold sub-spaces', () => {
    assert.equal(parentDenial({ parentId: null, personalOwnerId: null, isGlobal: false }), null)
  })
  it('a sub-space may not', () => {
    assert.match(parentDenial({ parentId: 'blackbird', personalOwnerId: null, isGlobal: false }) ?? '', /one level/)
  })
  it('neither may a personal space or Visvine', () => {
    assert.match(parentDenial({ parentId: null, personalOwnerId: 'u1', isGlobal: false }) ?? '', /personal/)
    assert.match(parentDenial({ parentId: null, personalOwnerId: null, isGlobal: true }) ?? '', /Visvine/)
  })
})

describe('flowsUp — visibility is the sub-space’s own', () => {
  it('only a public sub-space is read into its parent', () => {
    assert.equal(flowsUp({ visibility: 'public' }), true)
    assert.equal(flowsUp({ visibility: 'private' }), false)
    assert.equal(flowsUp({ visibility: null }), false)
  })
})

describe('paths under spaces/', () => {
  it('names the folder and parses it back', () => {
    assert.equal(subspaceFolderPath('founders'), 'spaces/founders')
    assert.deepEqual(parseSubspacePath('spaces/founders'), { spaceId: 'founders', path: '' })
    assert.deepEqual(parseSubspacePath('spaces/founders/people/craig/index.md'), {
      spaceId: 'founders',
      path: 'people/craig/index.md',
    })
    assert.equal(parseSubspacePath('spaces/'), null)
    assert.equal(parseSubspacePath('people/craig/index.md'), null)
    assert.equal(parseSubspacePath('spacesx/founders'), null)
  })
  it('rebases a sub-space path onto the parent', () => {
    assert.equal(rebasePath('founders', ''), 'spaces/founders')
    assert.equal(rebasePath('founders', 'playbooks/a.md'), 'spaces/founders/playbooks/a.md')
  })
  it('recognises the folder and everything under it, nothing beside it', () => {
    assert.equal(isSubspacePath(SUBSPACE_FOLDER), true)
    assert.equal(isSubspacePath('spaces/x/y.md'), true)
    assert.equal(isSubspacePath('spaces-old/x.md'), false)
    assert.equal(isSubspacePath('people/x.md'), false)
  })
})

describe('subspaceWriteDenial — spaces/ is read-only in the parent', () => {
  it('refuses the folder and anything under it', () => {
    assert.match(subspaceWriteDenial('spaces') ?? '', /read-only/)
    assert.match(subspaceWriteDenial('spaces/founders/notes.md') ?? '', /founders/)
  })
  it('leaves every other path alone', () => {
    assert.equal(subspaceWriteDenial('people/craig/index.md'), null)
    assert.equal(subspaceWriteDenial(''), null)
  })
})

describe('graftSubspace', () => {
  const subRoot = (): TreeNode => ({
    name: '',
    path: '',
    kind: 'folder',
    children: [
      { name: 'index.md', path: 'index.md', kind: 'note', title: 'Founders Network' },
      {
        name: 'playbooks',
        path: 'playbooks',
        kind: 'folder',
        children: [{ name: 'a.md', path: 'playbooks/a.md', kind: 'note', title: 'A' }],
      },
    ],
  })

  it('puts the sub-space under spaces/<id> with its root index as the folder index', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    const folder = graftSubspace(root, { id: 'founders', name: 'Founders Network' }, subRoot())
    const holder = root.children!.find((c) => c.path === 'spaces')!
    assert.equal(holder.kind, 'folder')
    assert.equal(holder.children![0], folder)
    assert.equal(folder.path, 'spaces/founders')
    assert.equal(folder.title, 'Founders Network')
    assert.equal(folder.space, 'founders')
    const paths = folder.children!.map((c) => c.path).sort()
    assert.deepEqual(paths, ['spaces/founders/index.md', 'spaces/founders/playbooks'])
    const playbooks = folder.children!.find((c) => c.path === 'spaces/founders/playbooks')!
    assert.equal(playbooks.children![0].path, 'spaces/founders/playbooks/a.md')
  })

  it('a second sub-space joins the same spaces/ folder', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    graftSubspace(root, { id: 'a', name: 'A' }, subRoot())
    graftSubspace(root, { id: 'b', name: 'B' }, subRoot())
    const holders = root.children!.filter((c) => c.path === 'spaces')
    assert.equal(holders.length, 1)
    assert.deepEqual(
      holders[0].children!.map((c) => c.path),
      ['spaces/a', 'spaces/b'],
    )
  })

  it('does not mutate the sub-space’s own tree', () => {
    const own = subRoot()
    graftSubspace({ name: '', path: '', kind: 'folder', children: [] }, { id: 'a', name: 'A' }, own)
    assert.equal(own.children![1].path, 'playbooks')
  })
})

describe('rebaseMeta', () => {
  it('moves the path, the folder and the link targets together', () => {
    const meta = rebaseMeta(
      { path: 'playbooks/a.md', folder: 'playbooks', linkTargets: ['index.md', 'playbooks/b.md'], title: 'A' },
      'founders',
    )
    assert.equal(meta.path, 'spaces/founders/playbooks/a.md')
    assert.equal(meta.folder, 'spaces/founders/playbooks')
    assert.deepEqual(meta.linkTargets, ['spaces/founders/index.md', 'spaces/founders/playbooks/b.md'])
    assert.equal(meta.title, 'A')
  })
  it('a root-level note lands in the sub-space folder itself', () => {
    assert.equal(rebaseMeta({ path: 'index.md', folder: '', linkTargets: [] }, 'founders').folder, 'spaces/founders')
  })
})

describe('rebaseNoteLinks', () => {
  it('rewrites root-absolute and relative links into the sub-space, leaving the frontmatter and external links alone', () => {
    const content =
      '---\ntitle: The first hire\ntags: [a]\n---\n\n' +
      'See [office hours](office-hours.md), the [index](/index.md) and [the web](https://example.com).'
    const out = rebaseNoteLinks(content, 'founders', 'playbooks/first-hire.md')
    assert.match(out, /^---\ntitle: The first hire\ntags: \[a\]\n---\n/)
    assert.match(out, /\[office hours\]\(\/spaces\/founders\/playbooks\/office-hours\.md\)/)
    assert.match(out, /\[index\]\(\/spaces\/founders\/index\.md\)/)
    assert.match(out, /\[the web\]\(https:\/\/example\.com\)/)
  })
  it('a note with no frontmatter comes back as a body', () => {
    assert.equal(rebaseNoteLinks('See [x](x.md).', 'f', 'a.md'), 'See [x](/spaces/f/x.md).')
  })
})

describe('spaceBranches / spaceTrail — the switcher’s columns', () => {
  const spaces = [
    { id: 'alpha', parentId: null },
    { id: 'blackbird', parentId: null },
    { id: 'founders', parentId: 'blackbird' },
    { id: 'ic', parentId: 'blackbird' },
    { id: 'orphan', parentId: 'elsewhere' },
  ]
  it('carries each sub-space on its parent’s branch, and an unlisted parent’s child on its own', () => {
    assert.deepEqual(
      spaceBranches(spaces).map((b) => [b.space.id, b.children.map((c) => c.id)]),
      [
        ['alpha', []],
        ['blackbird', ['founders', 'ic']],
        ['orphan', []],
      ],
    )
  })
  it('the trail is parent then child, or the space alone', () => {
    const byId = new Map(spaces.map((s) => [s.id, s]))
    assert.deepEqual(spaceTrail(byId.get('founders')!, byId).map((s) => s.id), ['blackbird', 'founders'])
    assert.deepEqual(spaceTrail(byId.get('orphan')!, byId).map((s) => s.id), ['orphan'])
  })
})

describe('spaceMark — a sub-space wears its parent’s picture', () => {
  const spaces = [
    { id: 'blackbird', name: 'Blackbird', imageUrl: 'bb.png', parentId: null },
    { id: 'ic', name: 'Investment Committee', imageUrl: 'ic.png', parentId: 'blackbird' },
    { id: 'orphan', name: 'Orphan', imageUrl: 'o.png', parentId: 'elsewhere' },
  ]
  it('a top-level space wears its own', () => {
    assert.deepEqual(spaceMark(spaces[0], spaces), { name: 'Blackbird', imageUrl: 'bb.png' })
  })
  it('a sub-space wears the parent’s, whatever it holds itself', () => {
    assert.deepEqual(spaceMark(spaces[1], spaces), { name: 'Blackbird', imageUrl: 'bb.png' })
  })
  it('falls back to its own when the parent is not in the list', () => {
    assert.deepEqual(spaceMark(spaces[2], spaces), { name: 'Orphan', imageUrl: 'o.png' })
  })
})
