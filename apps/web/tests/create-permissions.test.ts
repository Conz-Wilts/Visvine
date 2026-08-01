// The one gate behind both create entry points (the sidebar's "+" caret menu
// and the docked panel's type grid). The regression it exists to prevent: the
// caret menu used to be an unfiltered hardcoded list, so a member — or anyone
// in a community with channels switched off — was offered Channel and Space and
// only found out on submit.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/create-permissions.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { canCreateType } from '@/lib/create/creatable'
import type { CommunityFeatureConfig } from '@/lib/types'

const ADMIN = { featureConfig: null, isAdmin: true }
const MEMBER = { featureConfig: null, isAdmin: false }
const off = (...keys: string[]): { featureConfig: CommunityFeatureConfig; isAdmin: boolean } => ({
  // An empty/absent `enabled` map means everything is on, so switching a feature
  // off means listing the others.
  featureConfig: {
    enabled: Object.fromEntries(
      ['channels', 'notes', 'tasks', 'resources'].map((k) => [k, !keys.includes(k)]),
    ),
  } as CommunityFeatureConfig,
  isAdmin: true,
})

test('channels and spaces need the channels feature AND admin', () => {
  assert.equal(canCreateType('channel', ADMIN), true)
  assert.equal(canCreateType('space', ADMIN), true)
  // A member is never offered them, however the community is configured.
  assert.equal(canCreateType('channel', MEMBER), false)
  assert.equal(canCreateType('space', MEMBER), false)
  // Nor is an admin once the feature is off.
  assert.equal(canCreateType('channel', off('channels')), false)
  assert.equal(canCreateType('space', off('channels')), false)
})

test('brain types follow the notes feature, and connectors are admin-only', () => {
  assert.equal(canCreateType('file', ADMIN), true)
  assert.equal(canCreateType('file', MEMBER), true) // uploading is a member capability
  assert.equal(canCreateType('connector', ADMIN), true)
  // connectors/ is admin-write in brainService.writeDenial — don't offer the form.
  assert.equal(canCreateType('connector', MEMBER), false)
  // `notes` is a CORE feature (featureAccess.CORE_FEATURE_KEYS), so it can't
  // actually be switched off — the check is there to keep the brain tiles tied
  // to Context if that ever changes, and must not accidentally hide them today.
  assert.equal(canCreateType('file', off('notes')), true)
  assert.equal(canCreateType('connector', off('notes')), true)
})

test('the note-first types and Community stay open to everyone', () => {
  for (const type of ['person', 'organization', 'resource', 'context', 'community'] as const) {
    assert.equal(canCreateType(type, MEMBER), true, type)
    assert.equal(canCreateType(type, off('channels', 'notes')), true, type)
  }
})
