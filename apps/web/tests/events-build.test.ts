// What an event becomes, from either front door.
//
// The composer's POST /api/events and the MCP create_event tool both hand their
// input to lib/events/build.ts. The point of these tests is that neither can
// drift into its own defaults: the id, the slug, the creator-as-host rule and
// the waitlist/guest-list defaults are asserted here once, and both doors
// inherit them.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/events-build.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNewEvent, mergeEventUpdate } from '@/lib/events/build'
import { eventCreateInputSchema, eventUpdateInputSchema } from '@/lib/schemas/eventSchemas'

/** Input as it reaches the builder — i.e. through the schema both doors parse. */
function input(overrides: Record<string, unknown> = {}) {
  return eventCreateInputSchema.parse({
    spaceId: 'space_1',
    title: 'Launch Night',
    startAt: '2026-09-14T06:00:00.000Z',
    ...overrides,
  })
}

test('the id and slug derive from the title and date, and the creator is a host', () => {
  const event = buildNewEvent(input(), { personId: 'person:ada' })
  assert.equal(event.id, 'event:launch-night-20260914')
  assert.equal(event.slug, 'launch-night-20260914')
  assert.deepEqual(event.hosts, ['person:ada'])
})

test('a supplied id is honoured, so a draft keeps one identity across autosaves', () => {
  const event = buildNewEvent(input({ id: 'event:draft-abc' }), { personId: 'person:ada' })
  assert.equal(event.id, 'event:draft-abc')
  assert.equal(event.slug, 'draft-abc')
})

test('the creator joins the named hosts without duplicating themselves', () => {
  const event = buildNewEvent(input({ hosts: ['person:ada', 'person:grace'] }), { personId: 'person:ada' })
  assert.deepEqual(event.hosts, ['person:ada', 'person:grace'])
})

test('an author with no person node leaves the host list as given', () => {
  const event = buildNewEvent(input({ hosts: ['person:grace'] }), { personId: null })
  assert.deepEqual(event.hosts, ['person:grace'])
})

test('capacity is what turns the waitlist on, and the guest list defaults visible', () => {
  const open = buildNewEvent(input(), {})
  assert.equal(open.waitlistEnabled, false)
  assert.equal(open.guestListVisible, true)
  assert.equal(open.allowPlusOnes, 0)

  const capped = buildNewEvent(input({ capacity: 40 }), {})
  assert.equal(capped.waitlistEnabled, true)

  // An explicit false survives a capacity: the caller outranks the inference.
  const forced = buildNewEvent(input({ capacity: 40, waitlistEnabled: false }), {})
  assert.equal(forced.waitlistEnabled, false)
})

test('an agent-created draft stays a draft; nothing else defaults to one', () => {
  assert.equal(buildNewEvent(input(), {}).status, 'published')
  assert.equal(buildNewEvent(input({ status: 'draft' }), {}).status, 'draft')
  // Visibility is the space by default — never public by accident.
  assert.equal(buildNewEvent(input(), {}).visibility, 'space')
})

test('a cover url set at build time is the one the record carries', () => {
  const event = buildNewEvent(input({ coverImageUrl: 'https://media.example/events/x/avatar-lg.webp' }), {})
  assert.equal(event.coverImageUrl, 'https://media.example/events/x/avatar-lg.webp')
})

test('an update touches only what it carries, and merges the form rather than replacing it', () => {
  const existing = buildNewEvent(input({ capacity: 40, hosts: ['person:ada'] }), {}, '2026-08-01T00:00:00.000Z')
  const updates = eventUpdateInputSchema.parse({ status: 'published', form: { requireApproval: true } })
  const merged = mergeEventUpdate(existing, updates, '2026-08-02T00:00:00.000Z')

  assert.equal(merged.status, 'published')
  assert.equal(merged.title, existing.title)
  assert.deepEqual(merged.hosts, ['person:ada'])
  assert.equal(merged.capacity, 40)
  // The form keeps its schema and gains the new flag.
  assert.equal(merged.form.requireApproval, true)
  assert.deepEqual(merged.form.schema, existing.form.schema)
  assert.equal(merged.form.enabled, existing.form.enabled)
  // Created stands; updated moves.
  assert.equal(merged.analytics.createdAt, '2026-08-01T00:00:00.000Z')
  assert.equal(merged.analytics.updatedAt, '2026-08-02T00:00:00.000Z')
})

test('an empty update is a no-op — the defaults of the create schema never leak into a PATCH', () => {
  const existing = buildNewEvent(input({ hosts: ['person:ada'], visibility: 'public' }), {})
  const merged = mergeEventUpdate(existing, eventUpdateInputSchema.parse({}))

  assert.deepEqual(merged.hosts, ['person:ada'])
  assert.equal(merged.visibility, 'public')
  assert.deepEqual(merged.form, existing.form)
})
