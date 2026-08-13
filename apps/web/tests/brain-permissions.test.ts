// Unit tests for the grant-based brain access model (lib/notes/shared/authz.ts)
// and the principal predicates over it, including a behavior-parity section
// that runs the OLD folder-registry scenarios through migrateLegacyRegistry and
// asserts the same read/write outcomes. Run with the repo's node test runner:
// node --import tsx --test tests/brain-permissions.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACCESS_LEVELS,
  LEVEL_COMMENT,
  LEVEL_EDIT,
  LEVEL_FULL,
  LEVEL_VIEW,
  accessSignature,
  canManage,
  canRead,
  canWrite,
  containsPath,
  effectiveLevel,
  folderVisible,
  grantReaches,
  isLockedPath,
  isRestrictedPath,
  levelName,
  migrateLegacyRegistry,
  parseLevel,
  readableRoots,
  winningGrant,
  type AccessGrant,
  type BrainAccess,
  type MigratedRegistry,
} from '../lib/notes/shared/authz'
import { audienceSummary } from '../lib/notes/shared/audience'
import {
  principalCanManage,
  principalCanRead,
  principalCanWrite,
  principalIsSuperAdmin,
  principalSeesFolder,
} from '../lib/notes/shared/permissions'
import { filterVisible, pathVisibleTo } from '../lib/notes/shared/visibility'
import type { BrainPrincipal, Folder, FolderLevel, FoldersConfig } from '../lib/notes/shared/brainTypes'

// fixtures

const grant = (
  resourcePath: string,
  level: number,
  subject: { type?: AccessGrant['subjectType']; id?: string } = {},
): AccessGrant => ({
  subjectType: subject.type ?? 'user',
  subjectId: subject.id ?? 'u-me',
  resourcePath,
  level,
})

const access = (
  grants: AccessGrant[],
  restricted: string[] = [],
  locked: string[] = [],
): BrainAccess => ({ grants, restricted, locked })

const principal = (userId: string, acc: BrainAccess, over: Partial<BrainPrincipal> = {}): BrainPrincipal => ({
  userId,
  email: `${userId}@x.test`,
  name: userId,
  spaceId: 'c1',
  spaceAdmin: false,
  access: acc,
  ...over,
})

// levels

test('levels are strictly ordered integers with stable names', () => {
  assert.ok(LEVEL_VIEW < LEVEL_COMMENT && LEVEL_COMMENT < LEVEL_EDIT && LEVEL_EDIT < LEVEL_FULL)
  assert.equal(levelName(LEVEL_VIEW), 'view')
  assert.equal(levelName(LEVEL_EDIT), 'edit')
  assert.equal(levelName(LEVEL_FULL), 'full')
  assert.equal(levelName(0), null)
  // In-between values floor to the level they imply.
  assert.equal(levelName(25), 'comment')
  for (const { name, level } of ACCESS_LEVELS) assert.equal(parseLevel(name), level)
  assert.equal(parseLevel('admin'), null)
  assert.equal(parseLevel(undefined), null)
})

// the tree walk

test('containsPath: root contains everything; folders contain their subtrees only', () => {
  assert.equal(containsPath('', 'anything/deep/note.md'), true)
  assert.equal(containsPath('deals', 'deals/canva.md'), true)
  assert.equal(containsPath('deals', 'deals/2026/q3.md'), true)
  assert.equal(containsPath('deals', 'deals.md'), false) // sibling FILE, not inside
  assert.equal(containsPath('deals', 'dealsroom/x.md'), false) // prefix ≠ ancestor
  assert.equal(containsPath('deals/canva.md', 'deals/canva.md'), true) // self
})

test('grantReaches: plain inheritance flows down; restriction cuts the beam', () => {
  const root = grant('', LEVEL_VIEW)
  assert.equal(grantReaches(root, 'strategy/2026.md', []), true)
  // teams/engineering is restricted: the root grant no longer reaches inside…
  assert.equal(grantReaches(root, 'teams/engineering/oncall.md', ['teams/engineering']), false)
  // …but a grant ON the boundary does, and so does one INSIDE it.
  assert.equal(
    grantReaches(grant('teams/engineering', LEVEL_EDIT), 'teams/engineering/oncall.md', ['teams/engineering']),
    true,
  )
  assert.equal(
    grantReaches(grant('teams/engineering/oncall.md', LEVEL_VIEW), 'teams/engineering/oncall.md', ['teams/engineering']),
    true,
  )
  // The restricted folder itself is also unreadable from above.
  assert.equal(grantReaches(root, 'teams/engineering', ['teams/engineering']), false)
})

test('nested restricted folders each demand the grant be on or inside them', () => {
  const cuts = ['teams', 'teams/board']
  // A grant on the outer boundary is still cut by the inner one…
  assert.equal(grantReaches(grant('teams', LEVEL_FULL), 'teams/board/minutes.md', cuts), false)
  // …a grant on the inner boundary reaches through both.
  assert.equal(grantReaches(grant('teams/board', LEVEL_VIEW), 'teams/board/minutes.md', cuts), true)
  // Outer grant still reaches the outer folder's own notes.
  assert.equal(grantReaches(grant('teams', LEVEL_FULL), 'teams/roster.md', cuts), true)
})

test('effectiveLevel is the MAX across reaching grants — grants only add', () => {
  const acc = access(
    [grant('', LEVEL_VIEW), grant('portfolio', LEVEL_EDIT), grant('portfolio/canva.md', LEVEL_COMMENT)],
    [],
  )
  assert.equal(effectiveLevel(acc, 'welcome.md'), LEVEL_VIEW)
  assert.equal(effectiveLevel(acc, 'portfolio/canva.md'), LEVEL_EDIT) // edit beats comment
  assert.equal(effectiveLevel(acc, 'nowhere/else.md'), LEVEL_VIEW)
  assert.equal(effectiveLevel(access([], []), 'welcome.md'), 0)
})

test('canRead/canWrite/canManage are threshold checks on the effective level', () => {
  const acc = access([grant('wiki', LEVEL_COMMENT), grant('deals', LEVEL_FULL)])
  assert.equal(canRead(acc, 'wiki/handbook.md'), true)
  assert.equal(canWrite(acc, 'wiki/handbook.md'), false) // comment < edit
  assert.equal(canWrite(acc, 'deals/canva.md'), true)
  assert.equal(canManage(acc, 'deals/canva.md'), true)
  assert.equal(canManage(acc, 'wiki/handbook.md'), false)
  assert.equal(canRead(acc, 'elsewhere.md'), false)
})

test('the model has no deny rules: adding a grant can never remove access', () => {
  const base = access([grant('', LEVEL_EDIT)])
  const withMore = access([grant('', LEVEL_EDIT), grant('deals', LEVEL_VIEW)])
  for (const path of ['welcome.md', 'deals/canva.md', 'x/y/z.md']) {
    assert.ok(effectiveLevel(withMore, path) >= effectiveLevel(base, path))
  }
})

// alias and space subjects (pre-scoped, so reach is subject-agnostic)

test('space, alias, and user grants compose additively for one principal', () => {
  const acc = access([
    grant('', LEVEL_VIEW, { type: 'space', id: '' }),
    grant('teams/engineering', LEVEL_EDIT, { type: 'alias', id: 'a-eng' }),
    grant('strategy/plan.md', LEVEL_FULL, { type: 'user', id: 'u-me' }),
  ], ['teams/engineering'])
  assert.equal(effectiveLevel(acc, 'handbook/intro.md'), LEVEL_VIEW) // space
  assert.equal(effectiveLevel(acc, 'teams/engineering/oncall.md'), LEVEL_EDIT) // alias, through the cut
  assert.equal(effectiveLevel(acc, 'strategy/plan.md'), LEVEL_FULL) // direct note grant
  assert.equal(effectiveLevel(acc, 'strategy/other.md'), LEVEL_VIEW) // note grant does not spread
})

// folder visibility, restriction, locks

test('folderVisible surfaces ancestors of deep grants; restricted stays dark otherwise', () => {
  const acc = access([grant('teams/engineering', LEVEL_EDIT)], ['teams/engineering'])
  assert.equal(folderVisible(acc, 'teams'), true) // ancestor of a readable grant
  assert.equal(folderVisible(acc, 'teams/engineering'), true)
  assert.equal(folderVisible(acc, 'teams/gtm'), false)
  const stranger = access([grant('', LEVEL_VIEW)], ['teams/engineering'])
  assert.equal(folderVisible(stranger, 'teams/engineering'), false) // cut blocks the root grant
  assert.equal(folderVisible(stranger, 'teams'), true) // teams/ itself is not restricted
})

test('isRestrictedPath and isLockedPath cover boundaries and their subtrees', () => {
  assert.equal(isRestrictedPath(['teams/board'], 'teams/board/minutes.md'), true)
  assert.equal(isRestrictedPath(['teams/board'], 'teams/board'), true)
  assert.equal(isRestrictedPath(['teams/board'], 'teams/roster.md'), false)
  assert.equal(isLockedPath(['frozen'], 'frozen/deep/note.md'), true)
  assert.equal(isLockedPath(['frozen'], 'thawed/note.md'), false)
})

// provenance and signatures

test('winningGrant picks highest level, then deepest resource, then user > alias > space', () => {
  const cuts: string[] = []
  const g1 = grant('', LEVEL_EDIT, { type: 'space', id: '' })
  const g2 = grant('portfolio', LEVEL_EDIT, { type: 'alias', id: 'a1' })
  const g3 = grant('portfolio', LEVEL_EDIT, { type: 'user', id: 'u1' })
  const g4 = grant('portfolio', LEVEL_FULL, { type: 'space', id: '' })
  assert.equal(winningGrant([g1, g2], 'portfolio/x.md', cuts), g2) // deeper beats shallower
  assert.equal(winningGrant([g2, g3], 'portfolio/x.md', cuts), g3) // user beats alias
  assert.equal(winningGrant([g3, g4], 'portfolio/x.md', cuts), g4) // level beats everything
  assert.equal(winningGrant([g1], 'unreached.md', ['unreachable']), g1)
  assert.equal(winningGrant([], 'x.md', cuts), null)
})

test('readableRoots and accessSignature: equal access ⇒ equal signature', () => {
  const a = access([grant('wiki', LEVEL_VIEW), grant('', LEVEL_EDIT)], ['teams/board'])
  const b = access([grant('', LEVEL_EDIT), grant('wiki', LEVEL_VIEW)], ['teams/board'])
  assert.deepEqual(readableRoots(a), ['', 'wiki'])
  assert.equal(accessSignature(a), accessSignature(b))
  const c = access([grant('wiki', LEVEL_VIEW)], ['teams/board'])
  assert.notEqual(accessSignature(a), accessSignature(c))
  // A restriction change alone changes the signature (the readable set shifts).
  const d = access([grant('wiki', LEVEL_VIEW), grant('', LEVEL_EDIT)], [])
  assert.notEqual(accessSignature(a), accessSignature(d))
})

// principal predicates + the visibility lens

const TREE = [
  { path: 'wiki/handbook.md' },
  { path: 'portfolio/canva.md' },
  { path: 'teams/engineering/oncall.md' },
  { path: 'welcome.md' },
]

test('principal predicates fold in the admin/system bypass', () => {
  const gated = principal('u-new', access([]))
  assert.equal(principalCanRead(gated, 'welcome.md'), false)
  assert.equal(principalCanWrite(gated, 'welcome.md'), false)
  assert.equal(principalCanManage(gated, 'welcome.md'), false)
  assert.equal(principalSeesFolder(gated, 'wiki'), false)
  for (const p of [
    principal('u-new', access([]), { spaceAdmin: true }),
    principal('u-new', access([]), { system: true }),
  ]) {
    assert.equal(principalIsSuperAdmin(p), true)
    assert.equal(principalCanRead(p, 'teams/engineering/oncall.md'), true)
    assert.equal(principalCanWrite(p, 'anything.md'), true)
    assert.equal(principalCanManage(p, 'anything.md'), true)
    assert.equal(principalSeesFolder(p, 'teams/engineering'), true)
  }
  assert.equal(principalIsSuperAdmin(principal('u-x', access([grant('', LEVEL_FULL)]))), false)
})

test('filterVisible hides everything no grant reaches — no title leak into the index', () => {
  const eng = principal('u-eng', access(
    [grant('', LEVEL_VIEW), grant('teams/engineering', LEVEL_EDIT)],
    ['teams/engineering'],
  ))
  assert.deepEqual(filterVisible(TREE, eng).map((i) => i.path), TREE.map((t) => t.path))

  const member = principal('u-member', access([grant('', LEVEL_VIEW)], ['teams/engineering']))
  assert.deepEqual(
    filterVisible(TREE, member).map((i) => i.path),
    ['wiki/handbook.md', 'portfolio/canva.md', 'welcome.md'],
  )
  assert.equal(pathVisibleTo('teams/engineering/oncall.md', member), false)

  const gatedOut = principal('u-none', access([], ['teams/engineering']))
  assert.deepEqual(filterVisible(TREE, gatedOut), [])
  assert.equal(filterVisible(TREE, principal('u-none', access([]), { spaceAdmin: true })).length, 4)
})

test('source paths (non-.md) go through the same predicates', () => {
  const member = principal('u-member', access([grant('', LEVEL_VIEW)], ['deals']))
  assert.equal(pathVisibleTo('wiki/pricing.csv', member), true)
  assert.equal(pathVisibleTo('deals/pricing.csv', member), false)
  const insider = principal('u-in', access([grant('deals', LEVEL_EDIT)], ['deals']))
  assert.equal(pathVisibleTo('deals/pricing.csv', insider), true)
})

// legacy registry migration: behavior parity

const legacyMember = (userId: string, level: FolderLevel) => ({
  userId,
  level,
  grantedBy: 'u-admin',
  grantedAt: '2026-01-01',
})

const legacyFolder = (
  id: string,
  visibility: 'public' | 'private',
  members: Array<[string, FolderLevel]>,
  locked = false,
): Folder => ({
  id,
  name: id || 'root',
  visibility,
  members: members.map(([u, l]) => legacyMember(u, l)),
  createdBy: 'u-admin',
  createdAt: '2026-01-01',
  ...(locked ? { locked: true } : {}),
})

/** Mimic lib/notes/access.ts#brainAccessFor's scoping over migrated rows. */
function scopeFor(migrated: MigratedRegistry, userId: string): BrainAccess {
  return {
    grants: migrated.grants.filter(
      (g) => g.subjectType === 'space' || (g.subjectType === 'user' && g.subjectId === userId),
    ),
    restricted: migrated.restricted,
    locked: migrated.locked,
  }
}

// The old gated-registry fixture: a private root gate (u-grand write, u-admin
// admin) plus a private deals folder where only u-reader can read.
const gatedLegacy = (): FoldersConfig => ({
  version: 1,
  folders: [
    legacyFolder('', 'private', [
      ['u-grand', 'write'],
      ['u-admin', 'admin'],
    ]),
    legacyFolder('deals', 'private', [['u-reader', 'read']]),
  ],
})

test('parity: the brain gate — grandfathered members keep root access, new joiners get nothing', () => {
  const migrated = migrateLegacyRegistry(gatedLegacy())
  const grand = principal('u-grand', scopeFor(migrated, 'u-grand'))
  const joiner = principal('u-new', scopeFor(migrated, 'u-new'))

  assert.equal(principalCanRead(grand, 'welcome.md'), true)
  assert.equal(principalCanWrite(grand, 'welcome.md'), true)
  assert.equal(principalCanRead(grand, 'scratch/idea.md'), true)
  assert.equal(principalCanWrite(grand, 'scratch/idea.md'), true)

  assert.equal(principalCanRead(joiner, 'welcome.md'), false)
  assert.equal(principalCanWrite(joiner, 'welcome.md'), false)
  assert.equal(principalCanRead(joiner, 'scratch/idea.md'), false)
})

test('parity: a private folder refines the root — readers in, root writers out', () => {
  const migrated = migrateLegacyRegistry(gatedLegacy())
  assert.deepEqual(migrated.restricted, ['deals'])
  // u-reader reads deals via their own grant even though the root excludes them…
  const reader = principal('u-reader', scopeFor(migrated, 'u-reader'))
  assert.equal(principalCanRead(reader, 'deals/canva.md'), true)
  assert.equal(principalCanWrite(reader, 'deals/canva.md'), false)
  // …and u-grand (root write) cannot see into the restricted deals folder.
  const grand = principal('u-grand', scopeFor(migrated, 'u-grand'))
  assert.equal(principalCanRead(grand, 'deals/canva.md'), false)
})

test('parity: legacy admin level maps to full (manages the folder), locks carry over', () => {
  const cfg: FoldersConfig = {
    version: 1,
    folders: [
      legacyFolder('', 'private', [['u-admin', 'admin']]),
      legacyFolder('frozen', 'public', [], true),
    ],
  }
  const migrated = migrateLegacyRegistry(cfg)
  assert.deepEqual(migrated.locked, ['frozen'])
  const admin = principal('u-admin', scopeFor(migrated, 'u-admin'))
  assert.equal(principalCanManage(admin, 'anything/inside.md'), true)
})

test('parity: public folders stay readable by every member, even gated-out ones', () => {
  const cfg: FoldersConfig = {
    version: 1,
    folders: [
      legacyFolder('', 'private', [['u-grand', 'write']]),
      legacyFolder('wiki', 'public', [['u-writer', 'write']]),
    ],
  }
  const migrated = migrateLegacyRegistry(cfg)
  const gatedOut = principal('u-outside', scopeFor(migrated, 'u-outside'))
  assert.equal(principalCanRead(gatedOut, 'wiki/handbook.md'), true) // space view grant
  assert.equal(principalCanWrite(gatedOut, 'wiki/handbook.md'), false)
  const writer = principal('u-writer', scopeFor(migrated, 'u-writer'))
  assert.equal(principalCanWrite(writer, 'wiki/handbook.md'), true)
  // Deliberate widening vs the legacy model: the additive rules let a root
  // WRITER keep edit level inside a public (non-restricted) folder.
  const grand = principal('u-grand', scopeFor(migrated, 'u-grand'))
  assert.equal(principalCanWrite(grand, 'wiki/handbook.md'), true)
})

// ── audienceSummary: the one-line "who can see this path" the MCP tools expose ──

test('audience: a space-wide grant reads as everyone', () => {
  const grants = [grant('', LEVEL_VIEW, { type: 'space', id: '' })]
  const a = audienceSummary('notes/idea.md', grants, [], { selfUserId: 'u-me', spaceName: 'Blackbird' })
  assert.equal(a.audience, 'everyone')
  assert.equal(a.line, 'everyone in Blackbird')
})

test('audience: no reaching grants means admins only', () => {
  const a = audienceSummary('private/plan.md', [], [], { selfUserId: 'u-me' })
  assert.equal(a.audience, 'admins-only')
  assert.equal(a.line, 'admins only')
})

test('audience: the private-by-default note shape — restricted, you + admins only', () => {
  // Exactly what makeNotePrivate produces: a space root grant that a
  // restricted note path cuts, plus the author's own FULL grant on the note.
  const grants = [
    grant('', LEVEL_VIEW, { type: 'space', id: '' }),
    grant('people/x.md', LEVEL_FULL, { id: 'u-me' }),
  ]
  const a = audienceSummary('people/x.md', grants, ['people/x.md'], { selfUserId: 'u-me' })
  assert.equal(a.audience, 'you-only')
  assert.equal(a.restricted, true)
  assert.equal(a.line, 'restricted — you + admins only')
})

test('audience: alias grants are named, deduped, capped, and other users only counted', () => {
  const grants = [
    grant('deals', LEVEL_VIEW, { type: 'alias', id: 'Investors' }),
    grant('deals', LEVEL_EDIT, { type: 'alias', id: 'Investors' }),
    grant('deals', LEVEL_VIEW, { type: 'alias', id: 'Team' }),
  ]
  const aliases = audienceSummary('deals/acme.md', grants, [], { selfUserId: 'u-me' })
  assert.equal(aliases.audience, 'aliases')
  assert.equal(aliases.line, 'aliases: Investors, Team + admins')

  const mixed = audienceSummary(
    'deals/acme.md',
    [...grants, grant('deals', LEVEL_VIEW, { id: 'u-other' }), grant('deals', LEVEL_VIEW, { id: 'u-third' })],
    [],
    { selfUserId: 'u-me' },
  )
  assert.equal(mixed.audience, 'mixed')
  assert.equal(mixed.line, 'aliases: Investors, Team + 2 direct grants + admins')

  const capped = audienceSummary(
    'deals/acme.md',
    ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => grant('deals', LEVEL_VIEW, { type: 'alias', id: name })),
    [],
    { selfUserId: 'u-me' },
  )
  assert.equal(capped.line, 'aliases: A, B, C, D (+2 more) + admins')
})

test('audience: a restricted folder cuts outside grants, so inside it only admins remain', () => {
  const grants = [grant('', LEVEL_VIEW, { type: 'space', id: '' })]
  const outside = audienceSummary('notes/open.md', grants, ['secret'], { selfUserId: 'u-me' })
  assert.equal(outside.audience, 'everyone')
  const inside = audienceSummary('secret/plan.md', grants, ['secret'], { selfUserId: 'u-me' })
  assert.equal(inside.audience, 'admins-only')
  assert.equal(inside.line, 'restricted — admins only')
  // …until a grant lands on or inside the boundary.
  const granted = audienceSummary(
    'secret/plan.md',
    [...grants, grant('secret', LEVEL_VIEW, { type: 'alias', id: 'Partners' })],
    ['secret'],
    { selfUserId: 'u-me' },
  )
  assert.equal(granted.line, 'restricted — aliases: Partners + admins')
})

test('audience: sub-view grants never count as audience', () => {
  // Levels below VIEW cannot exist today (view is the floor), but the guard
  // keeps a future level-0 tombstone from widening the reported audience.
  const a = audienceSummary('x.md', [grant('', 5, { type: 'space', id: '' })], [], { selfUserId: 'u-me' })
  assert.equal(a.audience, 'admins-only')
})
