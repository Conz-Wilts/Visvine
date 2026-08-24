// The generated half of an action note.
//
// This is what keeps the Visvine space's Context honest. An action's `params:` are
// rendered from the one Zod schema that actually validates a call, written into
// the note between machine markers, and regenerated on every sync — so the
// half a model relies on to make a correct call cannot drift from the code.
// Everything outside those markers belongs to whoever maintains the notes and
// must survive a sync untouched, which is the property that lets guidance be
// improved without a deploy.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/actions-contract.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  CONTRACT_CLOSE,
  CONTRACT_OPEN,
  applyContract,
  paramsOf,
  proseOutsideContract,
  renderContract,
  typeNameOf,
} from '@/lib/actions/shared/contract'
import { allActions } from '@/lib/actions/registry'

test('a parameter reports its type, whether it is required, and what it is for', () => {
  const params = paramsOf({
    space_id: z.string().describe('The space'),
    limit: z.number().int().min(1).max(500).optional().describe('How many'),
    kind: z.enum(['all', 'image']).optional(),
    tags: z.array(z.string()).optional(),
    // Described before the wrapper rather than after: both read the same way to
    // an author, so both must read the same way here.
    scope: z.enum(['shared', 'personal']).describe('Which context').optional(),
  })
  const by = Object.fromEntries(params.map((p) => [p.name, p]))

  assert.deepEqual(by.space_id, { name: 'space_id', type: 'string', required: true, description: 'The space' })
  assert.equal(by.limit.required, false)
  assert.equal(by.limit.type, 'number')
  assert.equal(by.kind.type, "'all' | 'image'")
  assert.equal(by.tags.type, 'string[]')
  assert.equal(by.scope.description, 'Which context')
})

test('a default counts as optional, and an unknown value degrades rather than throwing', () => {
  const params = paramsOf({ mode: z.string().default('light'), anything: z.unknown().optional() })
  assert.equal(params[0].required, false)
  assert.equal(params[1].type, 'value')
  assert.equal(typeNameOf(null), 'value')
})

test('a rendered contract names the endpoint, the scope and every argument', () => {
  const block = renderContract({
    action: 'search_context',
    scope: 'context:read',
    readOnly: true,
    destructive: false,
    params: paramsOf({ space_id: z.string().describe('The space'), query: z.string() }),
  })
  assert.match(block, /POST \/api\/actions\/search_context/)
  assert.match(block, /`context:read`/)
  assert.match(block, /Reads only/)
  assert.match(block, /\| `space_id` \| `string` \| yes \| The space \|/)
  assert.ok(block.startsWith(CONTRACT_OPEN))
  assert.ok(block.trimEnd().endsWith(CONTRACT_CLOSE))
})

test('a pipe in a description cannot break the table it lands in', () => {
  const block = renderContract({
    action: 'x',
    scope: 'context:read',
    readOnly: false,
    destructive: false,
    params: paramsOf({ mode: z.enum(['a', 'b']).describe('a | b, pick one') }),
  })
  const row = block.split('\n').find((l) => l.startsWith('| `mode`'))!
  assert.equal(row.split(/(?<!\\)\|/).length - 1, 5, 'the row must still have exactly five cell boundaries')
})

test('an action with no arguments says so instead of rendering an empty table', () => {
  const block = renderContract({
    action: 'list_spaces',
    scope: 'context:read',
    readOnly: true,
    destructive: false,
    params: [],
  })
  assert.match(block, /Takes no arguments/)
  assert.ok(!block.includes('| Parameter |'))
})

test('a sync replaces the contract and leaves every other word alone', () => {
  const authored = [
    'Prose an admin wrote, above.',
    '',
    CONTRACT_OPEN,
    '',
    'stale generated content',
    '',
    CONTRACT_CLOSE,
    '',
    'And a hard-won warning, below.',
  ].join('\n')

  const next = applyContract(authored, `${CONTRACT_OPEN}\n\nfresh\n\n${CONTRACT_CLOSE}`)
  assert.match(next, /Prose an admin wrote, above\./)
  assert.match(next, /And a hard-won warning, below\./)
  assert.match(next, /fresh/)
  assert.ok(!next.includes('stale generated content'))

  // Round trip: what a sync reads back as "the maintainer's prose" is exactly
  // what they wrote, with no trace of either contract.
  const prose = proseOutsideContract(next)
  assert.ok(!prose.includes(CONTRACT_OPEN))
  assert.ok(!prose.includes('fresh'))
  assert.match(prose, /Prose an admin wrote, above\./)
  assert.match(prose, /And a hard-won warning, below\./)
})

test('a note with no markers gains a contract rather than losing its prose', () => {
  const next = applyContract('Just prose.', `${CONTRACT_OPEN}\nblock\n${CONTRACT_CLOSE}`)
  assert.match(next, /Just prose\./)
  assert.match(next, /block/)
  // And an empty body is not padded with blank lines.
  assert.equal(applyContract('', `${CONTRACT_OPEN}\nb\n${CONTRACT_CLOSE}`).trimStart()[0], '<')
})

test('every shipped action renders a contract a caller could act on', () => {
  // The catalogue is only as good as its worst entry, and every one of these is
  // written into the notes by `db:actions:sync`.
  for (const def of allActions()) {
    const block = renderContract({
      action: def.name,
      scope: def.scope,
      readOnly: def.annotations?.readOnlyHint === true,
      destructive: def.annotations?.destructiveHint === true,
      params: paramsOf(def.input),
    })
    assert.match(block, new RegExp(`POST /api/actions/${def.name}`), `${def.name} has no endpoint line`)
    for (const param of paramsOf(def.input)) {
      assert.ok(block.includes(`\`${param.name}\``), `${def.name} omits ${param.name} from its contract`)
      assert.notEqual(param.type, '', `${def.name}.${param.name} rendered an empty type`)
    }
  }
})
