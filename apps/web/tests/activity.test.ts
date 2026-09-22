import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITY_PAGE_MAX,
  decodeActivityCursor,
  encodeActivityCursor,
  foldActivity,
  upcomingOf,
} from '../lib/activity/shared/fold'
import {
  oneLine,
  rowForAccessRequest,
  rowForEvent,
  rowForJoinRequest,
  rowForMention,
  rowForReply,
  rowForRun,
  type ActivityRow,
} from '../lib/activity/shared/rows'

const ana = { id: 'u-ana', name: 'Ana', image: null }

test('rowForRun: a finished run names the agent and carries the run; a failed one says so', () => {
  const ok = rowForRun({ id: 'r1', spaceId: 'acme', spaceName: 'Acme', agentName: 'digest', agentTitle: 'Weekly digest', status: 'succeeded', endedAt: '2026-09-22T08:00:00.000Z', summary: 'Two deals moved.', errorMessage: null })
  assert.equal(ok.id, 'run:r1')
  assert.equal(ok.kind, 'run')
  assert.equal(ok.title, 'Weekly digest finished')
  assert.equal(ok.subtitle, 'Two deals moved.')
  assert.deepEqual(ok.target, { type: 'agent', spaceId: 'acme', agentName: 'digest', runId: 'r1' })
  assert.match(ok.href, /^\/s\/acme\/directory\/agent(%3A|:)digest\?run=r1$/)
  const bad = rowForRun({ id: 'r2', spaceId: 'acme', spaceName: 'Acme', agentName: 'digest', agentTitle: 'Weekly digest', status: 'failed', endedAt: new Date('2026-09-22T09:00:00Z'), summary: null, errorMessage: 'The model rejected the key.' })
  assert.equal(bad.title, 'Weekly digest could not finish')
  assert.equal(bad.subtitle, 'The model rejected the key.')
  assert.equal(bad.at, '2026-09-22T09:00:00.000Z')
})

test('rowForMention / rowForReply name the person and the channel, never a DM', () => {
  const m = rowForMention({ mentionId: 'm1', messageId: 'msg1', conversationId: 'c1', conversationName: 'general', spaceId: 'acme', spaceName: 'Acme', createdAt: '2026-09-22T08:00:00.000Z', text: 'hey @you look', sender: ana })
  assert.equal(m.title, 'Ana mentioned you in general')
  assert.equal(m.actor?.id, 'u-ana')
  assert.deepEqual(m.target, { type: 'conversation', conversationId: 'c1', messageId: 'msg1' })
  const r = rowForReply({ messageId: 'msg2', conversationId: 'c2', conversationName: null, spaceId: null, spaceName: null, createdAt: '2026-09-22T08:00:00.000Z', text: 'yes', sender: ana })
  assert.equal(r.title, 'Ana replied to you')
  assert.equal(r.space, null)
})

test('request rows carry the existing doors as actions', () => {
  const j = rowForJoinRequest({ membershipId: 'sm1', spaceId: 'acme', spaceName: 'Acme', joinedAt: '2026-09-22T08:00:00.000Z', user: ana })
  assert.equal(j.title, 'Ana wants to join Acme')
  assert.deepEqual(j.actions?.map((a) => [a.label, a.method, a.href]), [
    ['Approve', 'PUT', '/api/spaces/acme/members/u-ana'],
    ['Decline', 'DELETE', '/api/spaces/acme/members/u-ana'],
  ])
  assert.deepEqual(j.actions?.[0].body, { status: 'active' })
  const a = rowForAccessRequest({ requestId: 'ar1', spaceId: 'acme', spaceName: 'Acme', resourcePath: 'deals', level: 30, message: 'for the Q3 review', createdAt: '2026-09-22T08:00:00.000Z', user: ana })
  assert.equal(a.title, 'Ana asks to edit deals')
  assert.equal(a.subtitle, 'for the Q3 review')
  assert.deepEqual(a.actions?.[1].body, { spaceId: 'acme', requestId: 'ar1', approve: false })
  const root = rowForAccessRequest({ requestId: 'ar2', spaceId: 'acme', spaceName: 'Acme', resourcePath: '', level: 10, message: null, createdAt: '2026-09-22T08:00:00.000Z', user: ana })
  assert.equal(root.title, 'Ana asks to view the whole context')
})

test('rowForEvent is dated by its start; oneLine caps', () => {
  const e = rowForEvent({ eventId: 'event:x', spaceId: 'acme', spaceName: 'Acme', title: 'Demo day', startAt: '2026-10-01T18:00:00.000Z', location: null, status: 'waitlisted' })
  assert.equal(e.at, '2026-10-01T18:00:00.000Z')
  assert.equal(e.subtitle, 'Waitlisted')
  assert.equal(oneLine('  a\n b  '), 'a b')
  assert.equal(oneLine('x'.repeat(200))?.length, 140)
  assert.equal(oneLine(''), null)
})

function row(id: string, at: string): ActivityRow {
  return { id, kind: 'run', at, title: id, subtitle: null, space: null, actor: null, href: '/', target: { type: 'agent', spaceId: 's', agentName: 'a', runId: null } }
}

test('foldActivity merges newest first, dedupes, pages by cursor', () => {
  const a = [row('a3', '2026-09-22T03:00:00.000Z'), row('a1', '2026-09-22T01:00:00.000Z')]
  const b = [row('b4', '2026-09-22T04:00:00.000Z'), row('a1', '2026-09-22T01:00:00.000Z'), row('b2', '2026-09-22T02:00:00.000Z')]
  const first = foldActivity([a, b], { limit: 2 })
  assert.deepEqual(first.items.map((r) => r.id), ['b4', 'a3'])
  assert.equal(first.nextCursor, '2026-09-22T03:00:00.000Z|a3')
  const second = foldActivity([a, b], { cursor: decodeActivityCursor(first.nextCursor), limit: 2 })
  assert.deepEqual(second.items.map((r) => r.id), ['b2', 'a1'])
  assert.equal(second.nextCursor, null)
  // Same instant: ids order the page and the cursor cuts between them.
  const tie = [row('t2', '2026-09-22T05:00:00.000Z'), row('t1', '2026-09-22T05:00:00.000Z')]
  const p1 = foldActivity([tie], { limit: 1 })
  assert.deepEqual(p1.items.map((r) => r.id), ['t2'])
  assert.deepEqual(foldActivity([tie], { cursor: decodeActivityCursor(p1.nextCursor), limit: 1 }).items.map((r) => r.id), ['t1'])
  assert.equal(foldActivity([tie], { limit: 500 }).items.length, 2)
  assert.ok(ACTIVITY_PAGE_MAX >= 30)
  assert.deepEqual(decodeActivityCursor(encodeActivityCursor({ at: '2026-09-22T05:00:00.000Z', id: 'x' })), { at: new Date('2026-09-22T05:00:00.000Z'), id: 'x' })
  assert.equal(decodeActivityCursor('junk'), null)
})

test('upcomingOf keeps the future, soonest first, capped', () => {
  const now = new Date('2026-09-22T12:00:00.000Z')
  const rows = [row('past', '2026-09-22T11:00:00.000Z'), row('later', '2026-09-25T09:00:00.000Z'), row('soon', '2026-09-23T09:00:00.000Z')]
  assert.deepEqual(upcomingOf(rows, now).map((r) => r.id), ['soon', 'later'])
  assert.deepEqual(upcomingOf(rows, now, 1).map((r) => r.id), ['soon'])
})
