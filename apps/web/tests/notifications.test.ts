// Unit tests for the pure half of notifications (lib/notifications/types.ts):
// kinds, input normalisation, dedupe of recipients and the
// bell's clamp/relative-time helpers. The DB side (service.ts) is a thin
// Prisma wrapper: one INSERT … ON CONFLICT DO NOTHING, publishToUsers, fetch.
// Run: node --import tsx --test tests/notifications.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BODY_MAX_CHARS,
  LIST_MAX_TAKE,
  NOTIFICATION_KINDS,
  clampTake,
  invitationHref,
  invitationIdOfHref,
  isNotificationKind,
  normalizeNotifyInput,
  parseScope,
  relativeTime,
  scopeFilter,
  uniqueUserIds,
} from '../lib/notifications/types'
import { isForeignKeyFailure } from '../lib/notifications/service'

test('kinds: every writer is present and nothing else passes', () => {
  assert.deepEqual(
    [...NOTIFICATION_KINDS],
    [
      'connection_broken',
      'agent_deactivated',
      'agent_run_failed',
      'agent_notify',
      'agent_question',
      'tool_review',
      'tool_install_request',
      'access_request',
      'space_invite',
      'space_invite_answered',
      'projection_stalled',
    ],
  )
  assert.ok(isNotificationKind('tool_review'))
  assert.equal(isNotificationKind('email'), false)
  assert.equal(isNotificationKind(undefined), false)
})

test('normalizeNotifyInput trims, caps and defaults without throwing', () => {
  const n = normalizeNotifyInput({
    kind: 'agent_run_failed',
    title: '  Run failed  ',
    body: 'x'.repeat(BODY_MAX_CHARS + 500),
    href: ' /agents ',
    dedupeKey: ' agent:1:2026-08-19 ',
  })
  assert.equal(n.title, 'Run failed')
  assert.equal(n.body?.length, BODY_MAX_CHARS)
  assert.equal(n.href, '/agents')
  assert.equal(n.dedupeKey, 'agent:1:2026-08-19')
  assert.equal(n.spaceId, null)

  const bare = normalizeNotifyInput({ kind: 'access_request', title: '   ', body: '  ' })
  assert.equal(bare.title, 'access_request')
  assert.equal(bare.body, null)
  assert.equal(bare.href, null)
  assert.equal(bare.dedupeKey, null)
})

test('uniqueUserIds dedupes and drops blanks, keeping order', () => {
  assert.deepEqual(uniqueUserIds(['a', 'b', 'a', '', 'c', 'b']), ['a', 'b', 'c'])
  assert.deepEqual(uniqueUserIds([]), [])
})

test('clampTake: default, floor, cap', () => {
  assert.equal(clampTake(null), 30)
  assert.equal(clampTake('abc'), 30)
  assert.equal(clampTake('0'), 30)
  assert.equal(clampTake('7'), 7)
  assert.equal(clampTake('9999'), LIST_MAX_TAKE)
  assert.equal(clampTake(12.9), 12)
})

test('parseScope only honours the two real halves', () => {
  assert.equal(parseScope('global'), 'global')
  assert.equal(parseScope('space'), 'space')
  assert.equal(parseScope(null), 'all')
  assert.equal(parseScope('everything'), 'all')
})

test('scopeFilter: space with no space matches nothing, never everything', () => {
  assert.deepEqual(scopeFilter('all', 'sp1'), {})
  assert.deepEqual(scopeFilter('global', 'sp1'), { spaceId: null })
  assert.deepEqual(scopeFilter('space', 'sp1'), { spaceId: 'sp1' })
  // The one that matters: no current space must not fall back to unfiltered.
  assert.equal(scopeFilter('space', null), null)
})

test('an invitation id survives the round-trip through its href', () => {
  const href = invitationHref('inv-123')
  assert.equal(href, '/invitations/inv-123')
  assert.equal(invitationIdOfHref(href), 'inv-123')
  assert.equal(invitationIdOfHref(' /invitations/inv-123 '), 'inv-123')
  // Anything that isn't exactly one invitation path names no invitation.
  assert.equal(invitationIdOfHref('/invitations/inv-123/extra'), null)
  assert.equal(invitationIdOfHref('/directory/agent:foo'), null)
  assert.equal(invitationIdOfHref(null), null)
})

test('isForeignKeyFailure recognises a stale space id however Prisma reports it', () => {
  // Prisma's own code, pg's SQLSTATE in meta or as the code, or only in the message.
  assert.equal(isForeignKeyFailure({ code: 'P2003', meta: { field_name: 'space_id' } }), true)
  assert.equal(isForeignKeyFailure({ code: '23503' }), true)
  assert.equal(isForeignKeyFailure({ code: 'P2010', meta: { code: '23503', message: 'insert or update violates foreign key' } }), true)
  assert.equal(isForeignKeyFailure(new Error('insert or update on table "notifications" violates foreign key constraint "notifications_space_id_fkey"')), true)
  // Anything else stays a real failure.
  assert.equal(isForeignKeyFailure({ code: 'P2002' }), false)
  assert.equal(isForeignKeyFailure(new Error('connection refused')), false)
  assert.equal(isForeignKeyFailure(null), false)
  assert.equal(isForeignKeyFailure('23503'), false)
})

test('relativeTime buckets', () => {
  const now = Date.parse('2026-08-19T12:00:00Z')
  const at = (secAgo: number) => new Date(now - secAgo * 1000).toISOString()
  assert.equal(relativeTime(at(5), now), 'just now')
  assert.equal(relativeTime(at(5 * 60), now), '5m')
  assert.equal(relativeTime(at(3 * 3600), now), '3h')
  assert.equal(relativeTime(at(2 * 86400), now), '2d')
  assert.equal(relativeTime('nope', now), '')
  assert.match(relativeTime(at(30 * 86400), now), /^(\d+ \w+|\w+ \d+)$/)
})
