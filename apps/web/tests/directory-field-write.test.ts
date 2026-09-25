import test from 'node:test'
import assert from 'node:assert/strict'

import { parseFieldValue, planMetadataWrite, writableColumns, writableMetadataFields } from '@/lib/directory/fieldWrite'
import { addTrackedField, columnsForType } from '@/lib/directory/table'
import type { NodeTypeConfig } from '@/lib/types'

const deal: NodeTypeConfig = {
  name: 'Deal',
  color: '#000',
  shape: 'rectangle',
  fields: [
    { key: 'stage', label: 'Stage', kind: 'select', options: ['Lead', 'Won'] },
    { key: 'value', label: 'Value', kind: 'number' },
    { key: 'closed', label: 'Closed', kind: 'checkbox' },
    { key: 'labels', label: 'Labels', kind: 'tags' as never },
  ],
} as NodeTypeConfig

test('an event never takes its hosts, audience or draft flag through the field door', () => {
  for (const key of ['hosts', 'visibility', 'status', 'slug', 'form_schema']) {
    const plan = planMetadataWrite('event', null, { [key]: 'x' })
    assert.equal(plan.ok, false, key)
    assert.match((plan as { error: string }).error, /kept by the platform/)
  }
})

test('the keys every record keeps are refused on every type', () => {
  for (const type of ['person', 'space', 'resource', 'Deal']) {
    for (const key of ['userId', 'identityId', 'notePath', 'spaceRef', 'globalMode']) {
      assert.equal(planMetadataWrite(type, deal, { [key]: 'x' }).ok, false, `${type}.${key}`)
    }
  }
})

test("an event's own property rows still write, parsed", () => {
  const plan = planMetadataWrite('event', null, { start_at: '2026-10-01', capacity: '40' })
  assert.deepEqual(plan, { ok: true, metadata: { start_at: '2026-10-01', capacity: 40 } })
  assert.equal(planMetadataWrite('event', null, { start_at: 'next tuesday' }).ok, false)
})

test('a key the type does not declare is not a field', () => {
  const plan = planMetadataWrite('Deal', deal, { owner: 'Ana' })
  assert.deepEqual(plan, { ok: false, error: '"owner" is not a field of Deal' })
})

test('tracked fields parse by kind, typed or typed-in', () => {
  assert.deepEqual(planMetadataWrite('Deal', deal, { stage: 'Won', value: 1200, closed: true }), {
    ok: true,
    metadata: { stage: 'Won', value: 1200, closed: true },
  })
  assert.deepEqual(planMetadataWrite('Deal', deal, { value: '1,200', closed: 'yes' }), {
    ok: true,
    metadata: { value: 1200, closed: true },
  })
  assert.equal(planMetadataWrite('Deal', deal, { stage: 'Lost' }).ok, false)
  assert.equal(planMetadataWrite('Deal', deal, { value: 'lots' }).ok, false)
  assert.equal(planMetadataWrite('Deal', deal, { closed: 3 }).ok, false)
  assert.equal(planMetadataWrite('Deal', deal, { stage: { $ne: 1 } }).ok, false)
})

test('blank clears', () => {
  assert.deepEqual(planMetadataWrite('Deal', deal, { stage: null, value: '' }), {
    ok: true,
    metadata: { stage: null, value: null },
  })
})

test('a person’s profile-owned keys are read-only here', () => {
  for (const key of ['bio', 'website', 'phone', 'linkedinUrl']) {
    assert.equal(planMetadataWrite('person', null, { [key]: 'x' }).ok, false, key)
  }
  assert.equal(planMetadataWrite('person', null, { companyName: 'Halter' }).ok, true)
})

test('an agent’s cells are its record, never node metadata', () => {
  assert.equal(writableMetadataFields('agent', null).size, 0)
  assert.equal(planMetadataWrite('agent', null, { active: true }).ok, false)
})

test('a space’s url mirrors into website, which the door therefore takes for a space', () => {
  assert.equal(writableMetadataFields('space', null).has('website'), true)
  assert.equal(planMetadataWrite('space', null, { website: 'halter.io' }).ok, true)
})

test('a stored config naming a platform key opens nothing', () => {
  const sneaky = { ...deal, name: 'Event', fields: [{ key: 'hosts', label: 'Hosts', kind: 'text' }] } as NodeTypeConfig
  assert.equal(columnsForType('event', sneaky).some((c) => c.key === 'hosts'), false)
  assert.equal(planMetadataWrite('event', sneaky, { hosts: 'person:me' }).ok, false)
  assert.equal(addTrackedField({ ...deal, name: 'event', fields: [] } as NodeTypeConfig, { label: 'Hosts', kind: 'text' }).ok, false)
  assert.equal(addTrackedField({ ...deal, fields: [] } as NodeTypeConfig, { label: 'Note path', kind: 'text' }).ok, false)
})

test('columns are the ones the type has', () => {
  assert.deepEqual([...writableColumns('person')].sort(), ['image_url', 'location', 'subtitle'])
  assert.equal(writableColumns('person').has('url'), false)
  assert.equal(writableColumns('space').has('url'), true)
})

test('text over the cap is refused', () => {
  const text = { key: 'note', label: 'Note', kind: 'text', source: 'metadata', origin: 'tracked', editable: true } as const
  assert.equal(parseFieldValue('x'.repeat(6000), text).ok, false)
  assert.deepEqual(parseFieldValue('fine', text), { ok: true, value: 'fine' })
})
