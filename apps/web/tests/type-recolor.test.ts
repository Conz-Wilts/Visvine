/**
 * Moving stored built-in types onto the token palette (lib/types/recolor.ts).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/type-recolor.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { color } from '@visvine/tokens'

import { recolorBuiltInTypes } from '@/lib/types/recolor'
import { DEFAULT_NODE_TYPES } from '@/lib/types/context'

test('a built-in type still on a previous default moves to its token', () => {
  const { types, changed } = recolorBuiltInTypes([
    { name: 'Person', color: '#2563eb', shape: 'rectangle' },
    { name: 'Event', color: '#EF4444', shape: 'rectangle' },
  ])
  assert.equal(types[0].color, color.type.person.default)
  assert.equal(types[1].color, color.type.event.default)
  assert.deepEqual(changed, ['Person', 'Event'])
})

test('a colour an admin chose is kept, and so is a type that is not built in', () => {
  const input = [
    { name: 'Person', color: '#123456', shape: 'rectangle' as const },
    { name: 'Company', color: '#0891b2', shape: 'square' as const },
  ]
  const { types, changed } = recolorBuiltInTypes(input)
  assert.deepEqual(types, input)
  assert.deepEqual(changed, [])
})

test('re-running is a no-op, and the defaults are already on the palette', () => {
  const once = recolorBuiltInTypes([{ name: 'Space', color: '#4ade80', shape: 'square' }]).types
  assert.deepEqual(recolorBuiltInTypes(once).changed, [])
  assert.deepEqual(recolorBuiltInTypes(DEFAULT_NODE_TYPES).changed, [])
})
