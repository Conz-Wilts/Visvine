// Unit tests for the brain permission/visibility/placement layer (ported from
// blackbird-brain into lib/notes/shared). Run with the repo's node test runner:
// node --import tsx --test tests/brain-permissions.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canReadFolder,
  canWriteFolder,
  isFolderAdmin,
  memberLevel,
  principalCanRead,
  principalCanWrite,
  principalIsFolderAdmin,
  principalIsSuperAdmin,
  readableFolders,
} from '../lib/notes/shared/permissions'
import { filterVisible, pathVisibleTo } from '../lib/notes/shared/visibility'
import { folderIdOfPath, pathInFolder, ROOT_FOLDER } from '../lib/notes/shared/placement'
import type {
  BrainPrincipal,
  Folder,
  FolderLevel,
  FoldersConfig,
} from '../lib/notes/shared/brainTypes'

// --- fixtures ------------------------------------------------------------------

const member = (userId: string, level: FolderLevel) => ({
  userId,
  level,
  grantedBy: 'u-admin',
  grantedAt: '2026-01-01',
})

const folder = (id: string, visibility: 'public' | 'private', members: Array<[string, FolderLevel]>): Folder => ({
  id,
  name: id,
  visibility,
  members: members.map(([u, l]) => member(u, l)),
  createdBy: 'u-admin',
  createdAt: '2026-01-01',
})

// deals: private (reader/writer/admin members); wiki: public with one writer.
const registry = (): FoldersConfig => ({
  version: 1,
  folders: [
    folder('deals', 'private', [
      ['u-reader', 'read'],
      ['u-writer', 'write'],
      ['u-admin', 'admin'],
    ]),
    folder('wiki', 'public', [['u-writer', 'write']]),
  ],
})

const principal = (userId: string, over: Partial<BrainPrincipal> = {}): BrainPrincipal => ({
  userId,
  email: `${userId}@x.test`,
  name: userId,
  communityId: 'c1',
  communityAdmin: false,
  folders: registry(),
  ...over,
})

// --- folder-level predicates -----------------------------------------------------

test('levels are cumulative: admin ⊃ write ⊃ read', () => {
  const deals = registry().folders[0]
  assert.equal(memberLevel(deals, 'u-reader'), 'read')

  // read member: read yes, write/admin no
  assert.equal(canReadFolder(deals, 'u-reader'), true)
  assert.equal(canWriteFolder(deals, 'u-reader'), false)
  assert.equal(isFolderAdmin(deals, 'u-reader'), false)

  // write member: read+write yes, admin no
  assert.equal(canReadFolder(deals, 'u-writer'), true)
  assert.equal(canWriteFolder(deals, 'u-writer'), true)
  assert.equal(isFolderAdmin(deals, 'u-writer'), false)

  // admin member: everything
  assert.equal(canReadFolder(deals, 'u-admin'), true)
  assert.equal(canWriteFolder(deals, 'u-admin'), true)
  assert.equal(isFolderAdmin(deals, 'u-admin'), true)
})

test('public folder is readable by non-members but never writable by them', () => {
  const wiki = registry().folders[1]
  assert.equal(canReadFolder(wiki, 'u-stranger'), true)
  assert.equal(canWriteFolder(wiki, 'u-stranger'), false)
  assert.equal(isFolderAdmin(wiki, 'u-stranger'), false)
})

test('private folder is closed to non-members', () => {
  const deals = registry().folders[0]
  assert.equal(canReadFolder(deals, 'u-stranger'), false)
  assert.equal(canWriteFolder(deals, 'u-stranger'), false)
})

// --- principal-level checks ------------------------------------------------------

test('unregistered folders (and the root) default open for read AND write', () => {
  const p = principal('u-stranger')
  assert.equal(principalCanRead(p, 'random-folder'), true)
  assert.equal(principalCanWrite(p, 'random-folder'), true)
  assert.equal(principalCanRead(p, ROOT_FOLDER), true)
  assert.equal(principalCanWrite(p, ROOT_FOLDER), true)
  // ... but nobody administers an unregistered folder
  assert.equal(principalIsFolderAdmin(p, 'random-folder'), false)
})

test('registered folders enforce membership through the principal', () => {
  const stranger = principal('u-stranger')
  assert.equal(principalCanRead(stranger, 'deals'), false)
  assert.equal(principalCanWrite(stranger, 'deals'), false)
  assert.equal(principalCanRead(stranger, 'wiki'), true) // public
  assert.equal(principalCanWrite(stranger, 'wiki'), false)

  const reader = principal('u-reader')
  assert.equal(principalCanRead(reader, 'deals'), true)
  assert.equal(principalCanWrite(reader, 'deals'), false)
})

test('communityAdmin and system principals bypass every folder gate', () => {
  for (const p of [
    principal('u-stranger', { communityAdmin: true }),
    principal('u-stranger', { system: true }),
  ]) {
    assert.equal(principalIsSuperAdmin(p), true)
    assert.equal(principalCanRead(p, 'deals'), true)
    assert.equal(principalCanWrite(p, 'deals'), true)
    assert.equal(principalIsFolderAdmin(p, 'deals'), true)
    assert.equal(principalIsFolderAdmin(p, 'unregistered'), true)
  }
  assert.equal(principalIsSuperAdmin(principal('u-reader')), false)
})

test('readableFolders lists public folders plus private memberships; admins see all', () => {
  const cfg = registry()
  const strangerSees = readableFolders(cfg, principal('u-stranger'))
  assert.deepEqual(strangerSees.map((f) => f.id), ['wiki'])

  const readerSees = readableFolders(cfg, principal('u-reader'))
  assert.deepEqual(readerSees.map((f) => f.id).sort(), ['deals', 'wiki'])

  const adminSees = readableFolders(cfg, principal('u-stranger', { communityAdmin: true }))
  assert.equal(adminSees.length, cfg.folders.length)
})

// --- placement -------------------------------------------------------------------

test('folderIdOfPath takes the top-level segment; root notes map to ROOT_FOLDER', () => {
  assert.equal(folderIdOfPath('deals/canva.md'), 'deals')
  assert.equal(folderIdOfPath('deals/2026/q3.md'), 'deals') // only the top level governs
  assert.equal(folderIdOfPath('welcome.md'), ROOT_FOLDER)
  assert.equal(ROOT_FOLDER, '')
  assert.equal(pathInFolder('deals/canva.md', 'deals'), true)
  assert.equal(pathInFolder('wiki/canva.md', 'deals'), false)
  assert.equal(pathInFolder('welcome.md', ROOT_FOLDER), true)
})

// --- visibility ------------------------------------------------------------------

const items = [
  { path: 'deals/canva.md' }, // private folder
  { path: 'wiki/handbook.md' }, // public folder
  { path: 'scratch/idea.md' }, // unregistered folder
  { path: 'welcome.md' }, // root note
]

test('filterVisible hides private-folder paths from non-members only', () => {
  const stranger = principal('u-stranger')
  assert.deepEqual(
    filterVisible(items, stranger).map((i) => i.path),
    ['wiki/handbook.md', 'scratch/idea.md', 'welcome.md'],
  )
  assert.equal(pathVisibleTo('deals/canva.md', stranger), false)
  assert.equal(pathVisibleTo('deals/canva.md', principal('u-reader')), true)
})

test('filterVisible passes everything for members, admins, and system', () => {
  assert.equal(filterVisible(items, principal('u-reader')).length, 4)
  assert.equal(filterVisible(items, principal('u-stranger', { communityAdmin: true })).length, 4)
  assert.equal(filterVisible(items, principal('u-stranger', { system: true })).length, 4)
})

// --- the brain gate (root registry entry, id '') ---------------------------------

// A registry whose root entry gates the whole brain: u-grand was grandfathered
// (write), u-admin administers; deals keeps its own private ACL on top.
const gatedRegistry = (): FoldersConfig => ({
  version: 1,
  folders: [
    folder('', 'private', [
      ['u-grand', 'write'],
      ['u-admin', 'admin'],
    ]),
    folder('deals', 'private', [['u-reader', 'read']]),
  ],
})

test('root gate: unregistered folders and the root fall back to the root entry', () => {
  const grand = principal('u-grand', { folders: gatedRegistry() })
  const joiner = principal('u-new', { folders: gatedRegistry() })
  // Grandfathered member: root + unregistered folders read/write.
  assert.equal(principalCanRead(grand, ROOT_FOLDER), true)
  assert.equal(principalCanWrite(grand, ROOT_FOLDER), true)
  assert.equal(principalCanRead(grand, 'scratch'), true)
  assert.equal(principalCanWrite(grand, 'scratch'), true)
  // New joiner: nothing until granted.
  assert.equal(principalCanRead(joiner, ROOT_FOLDER), false)
  assert.equal(principalCanWrite(joiner, ROOT_FOLDER), false)
  assert.equal(principalCanRead(joiner, 'scratch'), false)
})

test('root gate: a registered folder ACL refines the root (does not widen to it)', () => {
  const reg = gatedRegistry()
  // u-reader can read deals via its own ACL even though the root excludes them...
  assert.equal(principalCanRead(principal('u-reader', { folders: reg }), 'deals'), true)
  // ...and u-grand (root write) cannot read the private deals folder.
  assert.equal(principalCanRead(principal('u-grand', { folders: reg }), 'deals'), false)
})

test('root gate: visibility lens hides everything from a gated-out member', () => {
  const joiner = principal('u-new', { folders: gatedRegistry() })
  assert.deepEqual(filterVisible(items, joiner), [])
  // Community admins bypass the gate entirely.
  assert.equal(filterVisible(items, principal('u-new', { folders: gatedRegistry(), communityAdmin: true })).length, 4)
})

test('root gate: root admins administer unregistered folders too', () => {
  const reg = gatedRegistry()
  assert.equal(principalIsFolderAdmin(principal('u-admin', { folders: reg }), 'scratch'), true)
  assert.equal(principalIsFolderAdmin(principal('u-grand', { folders: reg }), 'scratch'), false)
})
