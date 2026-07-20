// Unit tests for the pure half of the server vault memo (shared/vaultView.ts):
// the visibility signature must isolate differently-privileged viewers (a
// filtered viewer can never be handed the unfiltered index — that would leak
// private-folder titles through resolved links), and equally-privileged viewers
// must share one signature so the cached index build is actually reused.
// Run: node --import tsx --test tests/notes-vault-view.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildVaultView,
  seesUnfiltered,
  visibilitySignature,
} from '../lib/notes/shared/vaultView'
import type { BrainPrincipal, Folder, FoldersConfig } from '../lib/notes/shared/brainTypes'
import type { RawNote } from '../lib/notes/shared/types'

function folder(id: string, visibility: 'public' | 'private', memberIds: string[] = []): Folder {
  return {
    id,
    name: id,
    visibility,
    members: memberIds.map((userId) => ({
      userId,
      level: 'read' as const,
      grantedBy: 'admin',
      grantedAt: '2026-01-01',
    })),
    createdBy: 'admin',
    createdAt: '2026-01-01',
  }
}

function principal(userId: string, folders: Folder[], communityAdmin = false): BrainPrincipal {
  const cfg: FoldersConfig = { version: 1, folders }
  return { userId, email: `${userId}@x.com`, name: userId, communityId: 'c1', communityAdmin, folders: cfg }
}

const RAWS: RawNote[] = [
  { path: 'open/hello.md', content: '# Hello\n\nSee [Secret Deal](/private/deal.md).', mtime: 1 },
  { path: 'private/deal.md', content: '---\ntitle: Secret Deal\n---\n\nTerms.', mtime: 2 },
]

const FOLDERS = [folder('open', 'public'), folder('private', 'private', ['insider'])]

test('visibilitySignature separates privileged and unprivileged viewers', () => {
  const insider = principal('insider', FOLDERS)
  const outsider = principal('outsider', FOLDERS)
  const outsider2 = principal('other-outsider', FOLDERS)
  assert.notEqual(visibilitySignature(insider), visibilitySignature(outsider))
  // Equal privileges ⇒ equal signature ⇒ the cached view is shared.
  assert.equal(visibilitySignature(outsider), visibilitySignature(outsider2))
})

test('registering a folder changes the signature even when the readable set does not grow', () => {
  const before = visibilitySignature(principal('outsider', [folder('open', 'public')]))
  const after = visibilitySignature(principal('outsider', FOLDERS))
  assert.notEqual(before, after)
})

test('a root gate flips the unregistered-folder bit', () => {
  const gated = visibilitySignature(principal('outsider', [folder('', 'private', ['insider'])]))
  const open = visibilitySignature(principal('outsider', []))
  assert.notEqual(gated, open)
  assert.match(gated, /^u:0/)
  assert.match(open, /^u:1/)
})

test('seesUnfiltered: personal brains and super admins only', () => {
  assert.equal(seesUnfiltered(principal('anyone', FOLDERS), false), true) // personal brain
  assert.equal(seesUnfiltered(principal('admin', FOLDERS, true), true), true)
  assert.equal(seesUnfiltered(principal('outsider', FOLDERS), true), false)
})

test('buildVaultView filters raws and rebuilds the index without leaking hidden titles', () => {
  const view = buildVaultView(RAWS, principal('outsider', FOLDERS))
  assert.deepEqual(view.raws.map((r) => r.path), ['open/hello.md'])
  assert.deepEqual(view.metas.map((m) => m.path), ['open/hello.md'])
  // The link into the private folder must not resolve to a title.
  assert.equal(view.metas.some((m) => m.title === 'Secret Deal'), false)

  const insiderView = buildVaultView(RAWS, principal('insider', FOLDERS))
  assert.deepEqual(insiderView.raws.map((r) => r.path).sort(), ['open/hello.md', 'private/deal.md'])
})
