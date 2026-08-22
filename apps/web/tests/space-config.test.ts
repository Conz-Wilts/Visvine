// Unit tests for the pure merge rules behind a Space's JSON config columns
// (lib/spaces/configMerge.ts) and the featureConfig merge they sit beside
// (lib/featureAccess.ts). No database — lib/spaces/spaceConfig.ts is the thin
// locked wrapper that applies these.
//
// Everything here is one question asked five ways: what happens when a client
// saves a snapshot that is older than the data it is saving over.
// Run: node --import tsx --test tests/space-config.test.ts

import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  aliasKey,
  newAliasId,
  mergeAliasList,
  mergeLinkTypeList,
  mergeDesignConfig,
} from '../lib/spaces/configMerge'
import { mergeFeatureConfig } from '../lib/featureAccess'
import type { SpaceAlias, LinkTypeConfig } from '../lib/types/context'

const alias = (a: Partial<SpaceAlias> & { name: string }): SpaceAlias => ({
  color: '#000000',
  nodeType: 'Person',
  ...a,
})

const linkType = (a: Partial<LinkTypeConfig> & { name: string }): LinkTypeConfig => ({
  color: '#000000',
  directed: false,
  ...a,
})

describe('aliasKey', () => {
  test('is the id when there is one', () => {
    assert.equal(aliasKey(alias({ id: 'al_1', name: 'Founder' })), 'al_1')
  })

  test('two aliases with the same id are the same alias however they are named', () => {
    const before = alias({ id: 'al_1', name: 'Founder' })
    const after = alias({ id: 'al_1', name: 'Operator' })
    assert.equal(aliasKey(before), aliasKey(after))
  })

  test('falls back to the name for entries stored before ids existed', () => {
    assert.equal(aliasKey(alias({ name: 'Founder' })), aliasKey(alias({ name: '  founder ' })))
  })

  test('an id-less alias never collides with an id-bearing one', () => {
    assert.notEqual(aliasKey(alias({ name: 'Founder' })), aliasKey(alias({ id: 'Founder', name: 'x' })))
  })

  test('newAliasId is unique per call', () => {
    assert.notEqual(newAliasId(), newAliasId())
  })
})

describe('mergeAliasList', () => {
  test('keeps an alias the payload never heard of', () => {
    // The case that used to delete it: the Types page loaded before "Investor"
    // was created on Members, and saves without it.
    const stored = [alias({ id: 'al_1', name: 'Founder' }), alias({ id: 'al_2', name: 'Investor' })]
    const merged = mergeAliasList(stored, [alias({ id: 'al_1', name: 'Founder', color: '#ff0000' })])
    assert.deepEqual(merged.map((a) => a.name), ['Founder', 'Investor'])
    assert.equal(merged[0].color, '#ff0000') // the edit still lands
  })

  test('takes name and colour from the payload', () => {
    const merged = mergeAliasList(
      [alias({ id: 'al_1', name: 'Founder', color: '#000000' })],
      [alias({ id: 'al_1', name: 'Operator', color: '#00ff00' })],
    )
    assert.deepEqual(merged, [alias({ id: 'al_1', name: 'Operator', color: '#00ff00' })])
  })

  test('never lets a payload grant ownership', () => {
    const merged = mergeAliasList(
      [alias({ id: 'al_1', name: 'Founder' })],
      [alias({ id: 'al_1', name: 'Founder', admin: true })],
    )
    assert.equal(merged[0].admin, undefined)
  })

  test('never lets a payload strip ownership either', () => {
    const merged = mergeAliasList(
      [alias({ id: 'al_1', name: 'Founder', admin: true, system: true })],
      [alias({ id: 'al_1', name: 'Founder' })],
    )
    assert.equal(merged[0].admin, true)
    assert.equal(merged[0].system, true)
  })

  test('a brand-new alias arrives with no authority whatever it claims', () => {
    const merged = mergeAliasList([], [alias({ id: 'al_9', name: 'Sneaky', admin: true, system: true })])
    assert.equal(merged.length, 1)
    assert.equal(merged[0].admin, undefined)
    assert.equal(merged[0].system, undefined)
  })

  test('keeps stored order so a recolour does not shuffle the vocabulary', () => {
    const stored = ['a', 'b', 'c'].map((n, i) => alias({ id: `al_${i}`, name: n }))
    const merged = mergeAliasList(stored, [alias({ id: 'al_2', name: 'c', color: '#111111' })])
    assert.deepEqual(merged.map((a) => a.name), ['a', 'b', 'c'])
  })

  test('null storage and null payload are both empty, not a wipe', () => {
    assert.deepEqual(mergeAliasList(null, null), [])
    assert.deepEqual(mergeAliasList([alias({ id: 'al_1', name: 'Founder' })], null).length, 1)
  })
})

describe('mergeLinkTypeList', () => {
  test('keeps a link type the payload never heard of', () => {
    const stored = [linkType({ name: 'Knows' }), linkType({ name: 'Backed' })]
    const merged = mergeLinkTypeList(stored, [linkType({ name: 'Knows', color: '#ff0000' })])
    assert.deepEqual(merged.map((t) => t.name), ['Knows', 'Backed'])
    assert.equal(merged[0].color, '#ff0000')
  })

  test('matches names case- and whitespace-insensitively', () => {
    const merged = mergeLinkTypeList(
      [linkType({ name: 'Works at' })],
      [linkType({ name: ' works AT ', color: '#123456' })],
    )
    assert.equal(merged.length, 1)
    assert.equal(merged[0].color, '#123456')
  })

  test('takes direction from the payload', () => {
    const merged = mergeLinkTypeList(
      [linkType({ name: 'Partner', directed: false })],
      [linkType({ name: 'Partner', directed: true })],
    )
    assert.equal(merged[0].directed, true)
  })

  test('a system type cannot be un-systemed by a payload', () => {
    const merged = mergeLinkTypeList(
      [linkType({ name: 'Attended', system: true })],
      [linkType({ name: 'Attended', color: '#ffffff' })],
    )
    assert.equal(merged[0].system, true)
    assert.equal(merged[0].color, '#ffffff')
  })

  test('a payload cannot invent a system type', () => {
    const merged = mergeLinkTypeList([], [linkType({ name: 'Totally Normal', system: true })])
    assert.equal(merged[0].system, undefined)
  })

  test('re-adding a built-in system type gets its flag back from the defaults', () => {
    // Storage lost it (a space seeded before the type existed), so "is this a
    // system type" has to come from the registry, not the payload.
    const merged = mergeLinkTypeList([], [linkType({ name: 'Mentioned' })])
    assert.equal(merged[0].system, true)
  })

  test('appends genuinely new types after the stored ones', () => {
    const merged = mergeLinkTypeList([linkType({ name: 'Knows' })], [linkType({ name: 'Advises' })])
    assert.deepEqual(merged.map((t) => t.name), ['Knows', 'Advises'])
  })

  test('ignores a nameless entry rather than storing a blank type', () => {
    assert.deepEqual(mergeLinkTypeList([], [linkType({ name: '   ' })]), [])
  })
})

describe('mergeDesignConfig', () => {
  test('keeps tag colours when a design save omits them', () => {
    // The design panel has no tag UI, but any member can register a tag colour
    // through the tag-colors route while the panel is open.
    const merged = mergeDesignConfig(
      { tagColors: { ai: '#ff0000' } },
      { background: { type: 'solid', color: '#000000' } },
    )
    assert.deepEqual(merged.tagColors, { ai: '#ff0000' })
    assert.equal(merged.background?.color, '#000000')
  })

  test('merges tag colours entry by entry', () => {
    const merged = mergeDesignConfig(
      { tagColors: { ai: '#ff0000', saas: '#00ff00' } },
      { tagColors: { fintech: '#0000ff' } },
    )
    assert.deepEqual(merged.tagColors, { ai: '#ff0000', saas: '#00ff00', fintech: '#0000ff' })
  })

  test('an incoming colour for an existing tag wins', () => {
    const merged = mergeDesignConfig({ tagColors: { ai: '#ff0000' } }, { tagColors: { ai: '#0000ff' } })
    assert.deepEqual(merged.tagColors, { ai: '#0000ff' })
  })

  test('keeps other design keys the patch does not mention', () => {
    const merged = mergeDesignConfig(
      { background: { type: 'image', imageUrl: 'https://example.test/a.png' } },
      { tagColors: { ai: '#ff0000' } },
    )
    assert.equal(merged.background?.imageUrl, 'https://example.test/a.png')
  })

  test('an empty patch changes nothing', () => {
    const stored = { tagColors: { ai: '#ff0000' } }
    assert.deepEqual(mergeDesignConfig(stored, {}), stored)
    assert.deepEqual(mergeDesignConfig(stored, null), stored)
  })
})

describe('mergeFeatureConfig: enabled merges one tool at a time', () => {
  test('a patch toggling one tool leaves the others alone', () => {
    // Two console panels, or two tabs: one turns channels off, the other turns
    // resources on. Whole-value replacement made the second save erase the first.
    const merged = mergeFeatureConfig(
      { enabled: { channels: false, crm: false } },
      { enabled: { resources: true } },
    )
    assert.deepEqual(merged.enabled, { channels: false, crm: false, resources: true })
  })

  test('turning a tool off still works', () => {
    const merged = mergeFeatureConfig({ enabled: { channels: true } }, { enabled: { channels: false } })
    assert.equal(merged.enabled?.channels, false)
  })

  test('a core tool is still never storable as off', () => {
    const merged = mergeFeatureConfig({ enabled: { channels: false } }, { enabled: { events: false } })
    assert.equal(merged.enabled?.events, undefined)
    assert.equal(merged.enabled?.channels, false)
  })

  test('the sidebar layout is still inherited when only enabled is sent', () => {
    const merged = mergeFeatureConfig({ order: ['directory', 'events'] }, { enabled: { channels: false } })
    assert.deepEqual(merged.order, ['directory', 'events'])
  })

  test('arrays are still replaced whole — one panel owns each', () => {
    const merged = mergeFeatureConfig({ order: ['directory', 'events'] }, { order: ['events'] })
    assert.deepEqual(merged.order, ['events'])
  })
})
