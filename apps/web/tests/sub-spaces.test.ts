// The pure rules of sub-spaces (lib/spaces/subspaces.ts) and the one piece of
// the read-through that is pure: link rebasing (lib/notes/federation.ts).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PARENT_FOLDER,
  SUBSPACE_FOLDER,
  SUBSPACES_TITLE,
  ensureSubspacesFolder,
  pruneEmptySubspacesFolder,
  federatedWriteDenial,
  flowsUp,
  graftParent,
  isFederatedPath,
  isParentPath,
  isSharedDown,
  parentAdministers,
  parentWriteDenial,
  parseParentPath,
  rebaseParentMeta,
  rebaseParentNoteLinks,
  rebaseParentPath,
  doorsOf,
  flowsContext,
  flowsEvents,
  flowsPeople,
  joinOutcome,
  listingOf,
  presetByKey,
  shareTargets,
  subspaceConfigOf,
  subspaceOfPath,
  visibilityForListing,
  graftSubspace,
  isSubspacePath,
  spaceBranches,
  spaceMark,
  parentDenial,
  parseSubspacePath,
  rebaseMeta,
  rebaseNoteLinks,
  rebasePath,
  siblingNameTakenMessage,
  spaceTrail,
  subspaceFolderPath,
  subspaceWriteDenial,
} from '../lib/spaces/subspaces'
import { normalizePublicName } from '../lib/spaces/publicName'
import type { TreeNode } from '../lib/notes/shared/types'
import { sortTree } from '../lib/notes/shared/context'

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

describe('flowsUp — the room’s own switch, never from a secret room', () => {
  it('a listed room flows context unless it switched it off; a top-level space never flows', () => {
    assert.equal(flowsUp({ visibility: 'public', parentId: 'hq' }), true)
    assert.equal(flowsUp({ visibility: 'private', parentId: 'hq' }), true)
    assert.equal(flowsUp({ visibility: 'private', parentId: 'hq', flowContext: false }), false)
    assert.equal(flowsUp({ visibility: 'private', parentId: 'hq', listing: 'secret' }), false)
    assert.equal(flowsUp({ visibility: 'public', parentId: null }), false)
  })
})

describe('paths under subspaces/', () => {
  it('names the folder and parses it back', () => {
    assert.equal(subspaceFolderPath('founders'), 'subspaces/founders')
    assert.deepEqual(parseSubspacePath('subspaces/founders'), { spaceId: 'founders', path: '' })
    assert.deepEqual(parseSubspacePath('subspaces/founders/people/craig/index.md'), {
      spaceId: 'founders',
      path: 'people/craig/index.md',
    })
    assert.equal(parseSubspacePath('subspaces/'), null)
    assert.equal(parseSubspacePath('people/craig/index.md'), null)
    assert.equal(parseSubspacePath('subspacesx/founders'), null)
  })
  it('rebases a sub-space path onto the parent', () => {
    assert.equal(rebasePath('founders', ''), 'subspaces/founders')
    assert.equal(rebasePath('founders', 'playbooks/a.md'), 'subspaces/founders/playbooks/a.md')
  })
  it('recognises the folder and everything under it, nothing beside it', () => {
    assert.equal(isSubspacePath(SUBSPACE_FOLDER), true)
    assert.equal(isSubspacePath('subspaces/x/y.md'), true)
    assert.equal(isSubspacePath('subspaces-old/x.md'), false)
    assert.equal(isSubspacePath('people/x.md'), false)
  })
})

describe('subspaceWriteDenial — nothing of the parent’s is stored under subspaces/', () => {
  it('refuses the folder, a sub-space’s root, and anything under it — each with its own reason', () => {
    assert.match(subspaceWriteDenial('subspaces') ?? '', /nothing is written there/)
    assert.match(subspaceWriteDenial('subspaces/founders') ?? '', /the sub-space itself/)
    assert.match(subspaceWriteDenial('subspaces/founders/notes.md') ?? '', /written in that space/)
  })
  it('leaves every other path alone', () => {
    assert.equal(subspaceWriteDenial('people/craig/index.md'), null)
    assert.equal(subspaceWriteDenial(''), null)
  })
  it('names the sub-space a parent-side path belongs to', () => {
    assert.equal(subspaceOfPath('subspaces/founders/notes.md'), 'founders')
    assert.equal(subspaceOfPath('subspaces/founders'), 'founders')
    assert.equal(subspaceOfPath('subspaces'), null)
    assert.equal(subspaceOfPath('parent/connectors/x.md'), null)
    assert.equal(subspaceOfPath('people/craig.md'), null)
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

  it('puts the sub-space in one Sub-spaces folder, addressed under subspaces/<id>, with its root index as the folder index', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    const folder = graftSubspace(root, { id: 'founders', name: 'Founders Network' }, subRoot())
    const wrapper = root.children!.find((c) => c.path === SUBSPACE_FOLDER)!
    assert.equal(root.children!.length, 1)
    assert.equal(wrapper.title, SUBSPACES_TITLE)
    assert.equal(wrapper.space, undefined)
    assert.equal(wrapper.children![0], folder)
    assert.equal(folder.path, 'subspaces/founders')
    assert.equal(folder.title, 'Founders Network')
    assert.equal(folder.space, 'founders')
    const paths = folder.children!.map((c) => c.path).sort()
    assert.deepEqual(paths, ['subspaces/founders/index.md', 'subspaces/founders/playbooks'])
    const playbooks = folder.children!.find((c) => c.path === 'subspaces/founders/playbooks')!
    assert.equal(playbooks.children![0].path, 'subspaces/founders/playbooks/a.md')
  })

  it('stamps the folder writable only for a viewer who stands in the sub-space', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    const theirs = graftSubspace(root, { id: 'a', name: 'A' }, subRoot())
    const mine = graftSubspace(root, { id: 'b', name: 'B' }, subRoot(), true)
    assert.equal('writable' in theirs, false)
    assert.equal(mine.writable, true)
    // Only the folder carries it: the rows under it read the stamp off their space.
    assert.equal(mine.children!.every((c) => !('writable' in c)), true)
  })

  it('every sub-space sits in the one Sub-spaces folder, side by side', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    graftSubspace(root, { id: 'a', name: 'A' }, subRoot())
    graftSubspace(root, { id: 'b', name: 'B' }, subRoot())
    assert.deepEqual(root.children!.map((c) => c.path), [SUBSPACE_FOLDER])
    assert.deepEqual(
      root.children![0].children!.map((c) => c.path),
      ['subspaces/a', 'subspaces/b'],
    )
  })

  it('the Sub-spaces folder goes when nothing is drawn in it, wherever it is drawn', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    ensureSubspacesFolder(root)
    const ops: TreeNode = { name: 'ops', path: 'ops', kind: 'folder', children: [] }
    ensureSubspacesFolder(ops)
    root.children!.push(ops)
    pruneEmptySubspacesFolder(root)
    assert.deepEqual(root.children!.map((c) => c.path), ['ops'])
    assert.deepEqual(ops.children, [])
    // With a room in it, it stays.
    graftSubspace(root, { id: 'a', name: 'A' }, subRoot())
    pruneEmptySubspacesFolder(root)
    assert.equal(root.children!.some((c) => c.path === SUBSPACE_FOLDER), true)
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
    assert.equal(meta.path, 'subspaces/founders/playbooks/a.md')
    assert.equal(meta.folder, 'subspaces/founders/playbooks')
    assert.deepEqual(meta.linkTargets, ['subspaces/founders/index.md', 'subspaces/founders/playbooks/b.md'])
    assert.equal(meta.title, 'A')
  })
  it('a root-level note lands in the sub-space folder itself', () => {
    assert.equal(rebaseMeta({ path: 'index.md', folder: '', linkTargets: [] }, 'founders').folder, 'subspaces/founders')
  })
})

describe('rebaseNoteLinks', () => {
  it('rewrites root-absolute and relative links into the sub-space, leaving the frontmatter and external links alone', () => {
    const content =
      '---\ntitle: The first hire\ntags: [a]\n---\n\n' +
      'See [office hours](office-hours.md), the [index](/index.md) and [the web](https://example.com).'
    const out = rebaseNoteLinks(content, 'founders', 'playbooks/first-hire.md')
    assert.match(out, /^---\ntitle: The first hire\ntags: \[a\]\n---\n/)
    assert.match(out, /\[office hours\]\(\/subspaces\/founders\/playbooks\/office-hours\.md\)/)
    assert.match(out, /\[index\]\(\/subspaces\/founders\/index\.md\)/)
    assert.match(out, /\[the web\]\(https:\/\/example\.com\)/)
  })
  it('a note with no frontmatter comes back as a body', () => {
    assert.equal(rebaseNoteLinks('See [x](x.md).', 'f', 'a.md'), 'See [x](/subspaces/f/x.md).')
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

describe('another space is its own tier, below this one’s own context', () => {
  const folder = (name: string): TreeNode => ({ name, path: name, kind: 'folder', title: name, children: [] })

  it('`Sub-spaces` and `parent/` sort after every folder of the space’s own', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    root.children!.push(folder('zebras'), folder('agents'))
    ensureSubspacesFolder(root)
    graftParent(root, { id: 'house', name: 'Blackbird' }, { name: '', path: '', kind: 'folder', children: [] })
    sortTree(root)
    assert.deepEqual(
      root.children!.map((c) => c.path),
      ['agents', 'zebras', PARENT_FOLDER, SUBSPACE_FOLDER],
    )
  })

  it('a room’s folder is not federated itself — inside `Sub-spaces` the rooms sort by name', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    const empty = (): TreeNode => ({ name: '', path: '', kind: 'folder', children: [] })
    graftSubspace(root, { id: 'ops', name: 'Operations' }, empty())
    graftSubspace(root, { id: 'growth', name: 'Growth' }, empty())
    sortTree(root)
    assert.deepEqual(root.children![0].children!.map((c) => c.title), ['Growth', 'Operations'])
    assert.equal(root.children![0].children![0].federated, undefined)
  })
})

describe('sibling names — the key the index and the routes share', () => {
  // findSiblingNameConflict compares on normalizePublicName because the partial
  // index does (migration 20260910120000). The comparison is the whole rule, so
  // it is pinned here: a sub-space's name is unique among its siblings whatever
  // its VISIBILITY — a private one that reads the same as a sibling is refused
  // like any other, since two sub-spaces of one space must never be told apart
  // by name alone.
  const same = (a: string, b: string) => normalizePublicName(a) === normalizePublicName(b)

  it('case and inner whitespace do not make a new name', () => {
    assert.ok(same('Finance Team', 'finance   team'))
    assert.ok(same('  Ops  ', 'ops'))
  })

  it('different names stay different', () => {
    assert.ok(!same('Finance Team', 'Finance Teams'))
    assert.ok(!same('Ops', 'Op s'))
  })

  it('the refusal names the sibling that holds it and its parent', () => {
    const msg = siblingNameTakenMessage('Finance Team', 'Test')
    assert.match(msg, /Test/)
    assert.match(msg, /Finance Team/)
  })
})

// ─── What flows down, and who walks in ───────────────────────────────────────

describe('paths under parent/ — the mirror of subspaces/', () => {
  it('names the folder and parses it back', () => {
    assert.equal(PARENT_FOLDER, 'parent')
    assert.equal(parseParentPath('parent'), '')
    assert.equal(parseParentPath('parent/connectors/hubspot.md'), 'connectors/hubspot.md')
    assert.equal(parseParentPath('people/x.md'), null)
    assert.equal(parseParentPath('parents/x.md'), null)
  })
  it('rebases a parent path onto the sub-space', () => {
    assert.equal(rebaseParentPath(''), 'parent')
    assert.equal(rebaseParentPath('agents/digest/index.md'), 'parent/agents/digest/index.md')
  })
  it('recognises the folder, and either federated address', () => {
    assert.equal(isParentPath('parent'), true)
    assert.equal(isParentPath('parent/agents'), true)
    assert.equal(isParentPath('parentage.md'), false)
    assert.equal(isFederatedPath('parent/x.md'), true)
    assert.equal(isFederatedPath('subspaces/a/x.md'), true)
    assert.equal(isFederatedPath('people/x.md'), false)
  })
})

describe('isSharedDown — the flag on the note is the whole grant', () => {
  it('only a connector or agent note flagged share: subspaces', () => {
    assert.equal(isSharedDown('connectors/hubspot.md', { share: 'subspaces' }), true)
    assert.equal(isSharedDown('agents/digest/index.md', { share: 'subspaces' }), true)
    assert.equal(isSharedDown('connectors/hubspot.md', { share: 'other-room' }, 'a'), false)
    assert.equal(isSharedDown('connectors/hubspot.md', {}), false)
    assert.equal(isSharedDown('connectors/hubspot.md', null), false)
  })
  it('never anything else, whatever it says', () => {
    assert.equal(isSharedDown('people/craig.md', { share: 'subspaces' }), false)
    assert.equal(isSharedDown('playbooks/x.md', { share: 'subspaces' }), false)
  })
})

describe('parentWriteDenial / federatedWriteDenial — read-only both ways', () => {
  it('refuses parent/ and everything under it, and still refuses subspaces/', () => {
    assert.match(parentWriteDenial('parent') ?? '', /read-only/)
    assert.match(parentWriteDenial('parent/connectors/x.md') ?? '', /read-only/)
    assert.equal(parentWriteDenial('connectors/x.md'), null)
    assert.match(federatedWriteDenial('subspaces/a/x.md') ?? '', /written in that space/)
    assert.match(federatedWriteDenial('parent/x.md') ?? '', /read-only/)
    assert.equal(federatedWriteDenial('people/x.md'), null)
  })
})

describe('graftParent — one folder, the parent’s name, only what was flagged', () => {
  const shared: TreeNode = {
    name: '', path: '', kind: 'folder',
    children: [
      { name: 'connectors', path: 'connectors', kind: 'folder', children: [
        { name: 'hubspot.md', path: 'connectors/hubspot.md', kind: 'note', title: 'HubSpot' },
      ] },
    ],
  }
  it('lands at the top level, addressed under parent/, stamped with the parent', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    const folder = graftParent(root, { id: 'hq', name: 'Visvine HQ' }, shared)
    assert.equal(root.children?.[0], folder)
    assert.equal(folder.path, 'parent')
    assert.equal(folder.title, 'Visvine HQ')
    assert.equal(folder.space, 'hq')
    assert.equal(folder.parent, true)
    assert.equal(folder.children?.[0].path, 'parent/connectors')
    assert.equal(folder.children?.[0].children?.[0].path, 'parent/connectors/hubspot.md')
  })
  it('does not mutate the shared tree', () => {
    const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
    graftParent(root, { id: 'hq', name: 'HQ' }, shared)
    assert.equal(shared.children?.[0].path, 'connectors')
  })
})

describe('rebaseParentMeta / rebaseParentNoteLinks', () => {
  it('moves the path, the folder and the link targets under parent/', () => {
    const meta = rebaseParentMeta({ path: 'connectors/hubspot.md', folder: 'connectors', linkTargets: ['models/gpt.md'] })
    assert.deepEqual(meta, { path: 'parent/connectors/hubspot.md', folder: 'parent/connectors', linkTargets: ['parent/models/gpt.md'] })
    assert.equal(rebaseParentMeta({ path: 'x.md', folder: '', linkTargets: [] }).folder, 'parent')
  })
  it('rewrites body links, leaves the frontmatter', () => {
    const out = rebaseParentNoteLinks('---\nshare: subspaces\n---\n\nSee [gpt](/models/gpt.md).', 'connectors/hubspot.md')
    assert.match(out, /^---\nshare: subspaces\n---/)
    assert.match(out, /parent\/models\/gpt\.md/)
  })
})

describe('listingOf / doorsOf / joinOutcome — the dials', () => {
  const room = { visibility: 'private', parentId: 'hq', personalOwnerId: null, listing: 'house', houseDoor: 'ask', worldDoor: 'open' }
  it('visibility is authoritative: public is world, private is house or secret, a top-level private space is secret', () => {
    assert.equal(listingOf({ ...room, visibility: 'public', listing: 'secret' }), 'world')
    assert.equal(listingOf(room), 'house')
    assert.equal(listingOf({ ...room, listing: 'secret' }), 'secret')
    assert.equal(listingOf({ ...room, parentId: null }), 'secret')
    assert.equal(visibilityForListing('world'), 'public')
    assert.equal(visibilityForListing('house'), 'private')
  })
  it('the world door is clamped to the house door, and only a world room has one', () => {
    assert.deepEqual(doorsOf({ ...room, visibility: 'public', houseDoor: 'ask', worldDoor: 'open' }), { house: 'ask', world: 'ask' })
    assert.deepEqual(doorsOf({ ...room, visibility: 'public', houseDoor: 'open', worldDoor: 'ask' }), { house: 'open', world: 'ask' })
    assert.deepEqual(doorsOf(room), { house: 'ask', world: 'invite' })
    assert.deepEqual(doorsOf({ ...room, listing: 'secret', houseDoor: 'open' }), { house: 'invite', world: 'invite' })
    // a top-level public space has only a world door, unclamped
    assert.deepEqual(doorsOf({ ...room, parentId: null, visibility: 'public', houseDoor: 'invite', worldDoor: 'open' }), { house: 'invite', world: 'open' })
  })
  it('a member of the house goes through the house door, everyone else through the world door', () => {
    assert.equal(joinOutcome(room, 'active'), 'pending')
    assert.equal(joinOutcome({ ...room, houseDoor: 'open' }, 'active'), 'active')
    assert.equal(joinOutcome({ ...room, houseDoor: 'invite' }, 'active'), 'deny')
    assert.equal(joinOutcome(room, null), 'deny')
    assert.equal(joinOutcome({ ...room, visibility: 'public', houseDoor: 'open', worldDoor: 'ask' }, null), 'pending')
    assert.equal(joinOutcome({ ...room, visibility: 'public', houseDoor: 'open', worldDoor: 'ask' }, 'active'), 'active')
    assert.equal(joinOutcome({ ...room, visibility: 'public', houseDoor: 'open', worldDoor: 'ask' }, 'pending'), 'pending')
  })
  it('a secret room, a private top-level space and a personal space take nobody', () => {
    assert.equal(joinOutcome({ ...room, listing: 'secret', houseDoor: 'open' }, 'active'), 'deny')
    assert.equal(joinOutcome({ ...room, parentId: null }, 'active'), 'deny')
    assert.equal(joinOutcome({ ...room, personalOwnerId: 'u1', houseDoor: 'open' }, 'active'), 'deny')
    // a public top-level space: the world door, open by default
    assert.equal(joinOutcome({ ...room, parentId: null, visibility: 'public' }, null), 'active')
    assert.equal(joinOutcome({ ...room, parentId: null, visibility: 'public', worldDoor: 'ask' }, null), 'pending')
  })
  it('flows are the room’s switches, and nothing flows from a secret room', () => {
    assert.equal(flowsContext({ ...room, flowContext: true }), true)
    assert.equal(flowsContext({ ...room, flowContext: false }), false)
    assert.equal(flowsContext({ ...room, listing: 'secret', flowContext: true }), false)
    assert.equal(flowsEvents({ ...room, flowEvents: true }), true)
    assert.equal(flowsPeople({ ...room }), false)
    assert.equal(flowsPeople({ ...room, flowPeople: true }), true)
    assert.equal(flowsUp({ ...room, visibility: 'public' }), true)
  })
  it('share targets: all, a list, or nobody — and only connectors, agents and tools', () => {
    assert.equal(shareTargets({ share: 'all' }), 'all')
    assert.equal(shareTargets({ share: 'subspaces' }), 'all')
    assert.deepEqual(shareTargets({ share: ['a', 'b'] }), ['a', 'b'])
    assert.deepEqual(shareTargets({ share: 'a, b' }), ['a', 'b'])
    assert.equal(shareTargets({}), 'none')
    assert.equal(isSharedDown('connectors/x.md', { share: ['a'] }, 'a'), true)
    assert.equal(isSharedDown('connectors/x.md', { share: ['a'] }, 'b'), false)
    assert.equal(isSharedDown('tools/x/index.md', { share: 'all' }, 'b'), true)
    assert.equal(isSharedDown('people/x.md', { share: 'all' }, 'b'), false)
  })
  it('presets are dial settings', () => {
    assert.equal(presetByKey('department')?.houseDoor, 'open')
    assert.equal(presetByKey('committee')?.listing, 'secret')
    assert.equal(presetByKey('tenant')?.parentAdmins, false)
    assert.equal(presetByKey('nope'), null)
    assert.deepEqual(subspaceConfigOf({ modelKeys: ['a'], hiddenFromBand: ['b'], junk: 1 }), { modelKeys: ['a'] })
    assert.deepEqual(subspaceConfigOf(null), { modelKeys: [] })
  })
})

describe('parentAdministers — the room hands out its own keys', () => {
  it('only a sub-space that turned it on', () => {
    assert.equal(parentAdministers({ parentId: 'hq', parentAdmins: true }), true)
    assert.equal(parentAdministers({ parentId: 'hq', parentAdmins: false }), false)
    assert.equal(parentAdministers({ parentId: 'hq' }), false)
    assert.equal(parentAdministers({ parentId: null, parentAdmins: true }), false)
  })
})
