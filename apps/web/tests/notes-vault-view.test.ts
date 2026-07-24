// Unit tests for the pure half of the server vault memo (shared/vaultView.ts):
// the visibility signature must isolate differently-privileged viewers (a
// filtered viewer can never be handed the unfiltered index — that would leak
// restricted-folder titles through resolved links), and equally-privileged
// viewers must share one signature so the cached index build is actually reused.
// Run: node --import tsx --test tests/notes-vault-view.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildVaultView,
  seesUnfiltered,
  visibilitySignature,
} from '../lib/notes/shared/vaultView'
import { LEVEL_EDIT, LEVEL_VIEW, type AccessGrant, type BrainAccess } from '../lib/notes/shared/authz'
import type { BrainPrincipal } from '../lib/notes/shared/brainTypes'
import type { RawNote } from '../lib/notes/shared/types'

const grant = (resourcePath: string, level: number): AccessGrant => ({
  subjectType: 'user',
  subjectId: 'me',
  resourcePath,
  level,
})

function principal(
  userId: string,
  grants: AccessGrant[],
  restricted: string[] = [],
  communityAdmin = false,
): BrainPrincipal {
  const access: BrainAccess = { grants, restricted, locked: [] }
  return { userId, email: `${userId}@x.com`, name: userId, communityId: 'c1', communityAdmin, access }
}

const RAWS: RawNote[] = [
  { path: 'open/hello.md', content: '# Hello\n\nSee [Secret Deal](/private/deal.md).', mtime: 1 },
  { path: 'private/deal.md', content: '---\ntitle: Secret Deal\n---\n\nTerms.', mtime: 2 },
]

// Everyone can read open/; private/ is restricted with insiders granted on it.
const MEMBER_GRANTS = [grant('', LEVEL_VIEW)]
const INSIDER_GRANTS = [grant('', LEVEL_VIEW), grant('private', LEVEL_EDIT)]
const RESTRICTED = ['private']

test('visibilitySignature separates privileged and unprivileged viewers', () => {
  const insider = principal('insider', INSIDER_GRANTS, RESTRICTED)
  const outsider = principal('outsider', MEMBER_GRANTS, RESTRICTED)
  const outsider2 = principal('other-outsider', MEMBER_GRANTS, RESTRICTED)
  assert.notEqual(visibilitySignature(insider), visibilitySignature(outsider))
  // Equal privileges ⇒ equal signature ⇒ the cached view is shared.
  assert.equal(visibilitySignature(outsider), visibilitySignature(outsider2))
})

test('a restriction change alone changes the signature', () => {
  const before = visibilitySignature(principal('outsider', MEMBER_GRANTS, []))
  const after = visibilitySignature(principal('outsider', MEMBER_GRANTS, RESTRICTED))
  assert.notEqual(before, after)
})

test('a gated-out member and an open member never share a signature', () => {
  const gated = visibilitySignature(principal('outsider', [], RESTRICTED))
  const open = visibilitySignature(principal('outsider', MEMBER_GRANTS, RESTRICTED))
  assert.notEqual(gated, open)
})

test('seesUnfiltered: personal brains and super admins only', () => {
  assert.equal(seesUnfiltered(principal('anyone', MEMBER_GRANTS, RESTRICTED), false), true) // personal brain
  assert.equal(seesUnfiltered(principal('admin', MEMBER_GRANTS, RESTRICTED, true), true), true)
  assert.equal(seesUnfiltered(principal('outsider', MEMBER_GRANTS, RESTRICTED), true), false)
})

test('buildVaultView filters raws and rebuilds the index without leaking hidden titles', () => {
  const view = buildVaultView(RAWS, principal('outsider', MEMBER_GRANTS, RESTRICTED))
  assert.deepEqual(view.raws.map((r) => r.path), ['open/hello.md'])
  assert.deepEqual(view.metas.map((m) => m.path), ['open/hello.md'])
  // The link into the restricted folder must not resolve to a title.
  assert.equal(view.metas.some((m) => m.title === 'Secret Deal'), false)

  const insiderView = buildVaultView(RAWS, principal('insider', INSIDER_GRANTS, RESTRICTED))
  assert.deepEqual(insiderView.raws.map((r) => r.path).sort(), ['open/hello.md', 'private/deal.md'])
})
