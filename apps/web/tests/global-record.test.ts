// The pure half of the Visvine global record: survivorship across sources,
// the machine block in the note, and the replica's `node:` rewrite.
// Run: node --import tsx --test tests/global-record.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateGlobalRecord,
  applyGlobalBlock,
  proseOutsideGlobalBlock,
  renderGlobalBlock,
  GLOBAL_OPEN,
  GLOBAL_CLOSE,
  type GlobalSource,
} from '../lib/global/shared/aggregate'
import { replicaContent } from '../lib/notes/publications'
import { parseFrontmatter } from '../lib/notes/shared/markdown'
import { isReservedSpaceId, isGlobalSpace, GLOBAL_SPACE_ID } from '../lib/spaces/globalSpace'

const node = (over: Partial<GlobalSource>): GlobalSource => ({
  kind: 'node',
  spaceId: 'sp',
  spaceName: 'Space',
  nodeId: 'person:x',
  name: 'Jane Doe',
  subtitle: null,
  location: null,
  url: null,
  imageUrl: null,
  tags: [],
  ...over,
})

test('the claimed profile wins every field it fills; public nodes fill the gaps', () => {
  const record = aggregateGlobalRecord(
    [
      node({ spaceId: 'a', spaceName: 'Alpha', subtitle: 'Founder at A', location: 'Sydney', tags: ['vc'] }),
      { ...node({ spaceId: null, spaceName: null }), kind: 'profile', name: 'Jane M. Doe', subtitle: 'CEO', bio: 'Hi.', tags: ['founder'] },
      node({ spaceId: 'b', spaceName: 'Beta', url: 'https://jane.example', imageUrl: 'img' }),
    ],
    'Jane',
  )
  assert.equal(record.fields.name, 'Jane M. Doe')
  assert.equal(record.fields.subtitle, 'CEO')
  assert.equal(record.fields.location, 'Sydney')
  assert.equal(record.fields.url, 'https://jane.example')
  assert.equal(record.fields.imageUrl, 'img')
  assert.deepEqual(record.fields.tags, ['founder', 'vc'])
  assert.equal(record.bio, 'Hi.')
  assert.deepEqual(record.appearsIn.map((a) => a.spaceName), ['Alpha', 'Beta'])
})

test('without a profile the most complete public node leads; the canonical name is the last resort', () => {
  const thin = node({ spaceId: 'a', spaceName: 'Alpha', name: 'J Doe' })
  const rich = node({ spaceId: 'b', spaceName: 'Beta', name: 'Jane Doe', subtitle: 'CTO', location: 'Auckland' })
  const record = aggregateGlobalRecord([thin, rich], 'fallback')
  assert.equal(record.fields.name, 'Jane Doe')
  assert.equal(record.fields.subtitle, 'CTO')
  assert.equal(aggregateGlobalRecord([], 'fallback').fields.name, 'fallback')
  assert.equal(aggregateGlobalRecord([node({ name: '  ' })], 'fallback').fields.name, 'fallback')
})

test('tags de-duplicate case-insensitively, profile first', () => {
  const record = aggregateGlobalRecord(
    [node({ tags: ['VC', 'founder'] }), { ...node({ spaceId: null }), kind: 'profile', tags: ['Founder'] }],
    'x',
  )
  assert.deepEqual(record.fields.tags, ['Founder', 'VC'])
})

test('the machine block is replaced in place and prose around it survives', () => {
  const record = aggregateGlobalRecord([node({ subtitle: 'CEO', location: 'Sydney' })], 'x')
  const block = renderGlobalBlock(record)
  assert.ok(block.startsWith(GLOBAL_OPEN) && block.endsWith(GLOBAL_CLOSE))
  assert.match(block, /> CEO/)
  assert.match(block, /- Location: Sydney/)
  assert.match(block, /## Appears in\n\n- Space/)

  const fresh = applyGlobalBlock('', block)
  assert.equal(fresh, `${block}\n`)

  const withProse = applyGlobalBlock('My own words.\n', block)
  assert.equal(withProse, `${block}\n\nMy own words.\n`)

  const next = renderGlobalBlock(aggregateGlobalRecord([node({ subtitle: 'Chair' })], 'x'))
  const replaced = applyGlobalBlock(withProse, next)
  assert.match(replaced, /> Chair/)
  assert.doesNotMatch(replaced, /> CEO/)
  assert.equal(proseOutsideGlobalBlock(replaced), 'My own words.')
  assert.equal((replaced.match(/global:record/g) ?? []).length, 2)
})

test('a global replica names the follower node, or drops node: when there is none', () => {
  const src = '---\ntype: Person\ntitle: Jane\nnode: person:jane\n---\n\nBody.\n'
  const follower = parseFrontmatter(replicaContent(src, { ref: 'visvine/people/jane.md', publisher: 'Visvine', node: 'person:jane-2' }))
  assert.equal(follower.node, 'person:jane-2')
  const orphan = parseFrontmatter(replicaContent(src, { ref: 'r', publisher: 'p', node: null }))
  assert.equal(orphan.node, undefined)
  const ordinary = parseFrontmatter(replicaContent(src, { ref: 'r', publisher: 'p' }))
  assert.equal(ordinary.node, 'person:jane')
})

test('the global space id is reserved alongside personal-space ids', () => {
  assert.ok(isGlobalSpace(GLOBAL_SPACE_ID))
  assert.ok(isReservedSpaceId('visvine'))
  assert.ok(isReservedSpaceId('me:abc'))
  assert.ok(!isReservedSpaceId('blackbird'))
})
