/**
 * Tool requirements (lib/tools/requirements.ts): which of a Tool's declared
 * connectors, node types and agents a space cannot satisfy, and how that reads
 * on the install checklist.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-requirements.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeRequirements,
  describeRequirements,
  isDegraded,
  parseRequirements,
  requirementsEqual,
  type SpaceAvailability,
  type ToolRequirements,
} from '@/lib/tools/requirements'
import { EMPTY_PERIMETER, parseToolPerimeter, type ToolPerimeter } from '@/lib/tools/perimeter'

function perimeter(patch: Partial<ToolPerimeter>): ToolPerimeter {
  return { ...EMPTY_PERIMETER, ...patch }
}

const NOTHING: SpaceAvailability = { connectors: [], types: [], agents: [] }

const FULL: SpaceAvailability = {
  connectors: ['hubspot', 'stripe'],
  types: ['person', 'space', 'deal'],
  agents: ['deal-summariser', 'weekly-digest'],
}

// ── what counts as missing ──

test('a declared name with a match in the space is not a requirement', () => {
  const req = computeRequirements(
    perimeter({ connectors: ['hubspot'], types: ['deal'], agents: ['weekly-digest'] }),
    FULL,
  )
  assert.deepEqual(req, { connectors: [], types: [], agents: [] })
  assert.equal(isDegraded(req), false)
})

test('a declared name with nothing to match is a requirement', () => {
  const req = computeRequirements(
    perimeter({ connectors: ['salesforce'], types: ['invoice'], agents: ['nightly'] }),
    FULL,
  )
  assert.deepEqual(req, {
    connectors: ['salesforce'],
    types: ['invoice'],
    agents: ['nightly'],
  })
  assert.equal(isDegraded(req), true)
})

test('a prefix is satisfied by one match and missing when there are none', () => {
  const met = computeRequirements(perimeter({ agents: ['deal-*'] }), FULL)
  assert.deepEqual(met.agents, [])

  const unmet = computeRequirements(perimeter({ agents: ['invoice-*'] }), FULL)
  assert.deepEqual(unmet.agents, ['invoice-*'])
})

test('`*` is never a requirement — a space with none still satisfies "any"', () => {
  const req = computeRequirements(
    perimeter({ connectors: ['*'], types: ['*'], agents: ['*'] }),
    NOTHING,
  )
  assert.deepEqual(req, { connectors: [], types: [], agents: [] })
  assert.equal(isDegraded(req), false)
})

test('matching is case-insensitive, as the perimeter gates are', () => {
  const req = computeRequirements(perimeter({ connectors: ['HubSpot'] }), {
    ...NOTHING,
    connectors: ['hubspot'],
  })
  assert.deepEqual(req.connectors, [])
})

test('declaring nothing needs nothing', () => {
  assert.deepEqual(computeRequirements(EMPTY_PERIMETER, NOTHING), {
    connectors: [],
    types: [],
    agents: [],
  })
})

test('note globs are never requirements — an empty folder is not a missing feature', () => {
  const parsed = parseToolPerimeter({ read: ['deals/**'], write: ['deals/**'] })
  assert.ok(parsed.ok)
  const req = computeRequirements(parsed.perimeter, NOTHING)
  assert.deepEqual(req, { connectors: [], types: [], agents: [] })
})

test('every unmet dimension degrades on its own', () => {
  assert.equal(isDegraded({ connectors: ['x'], types: [], agents: [] }), true)
  assert.equal(isDegraded({ connectors: [], types: ['x'], agents: [] }), true)
  assert.equal(isDegraded({ connectors: [], types: [], agents: ['x'] }), true)
  assert.equal(isDegraded({ connectors: [], types: [], agents: [] }), false)
})

// ── the checklist ──

test('describeRequirements names each missing thing, connectors first', () => {
  const req: ToolRequirements = {
    connectors: ['salesforce'],
    types: ['invoice'],
    agents: ['deal-*'],
  }
  assert.deepEqual(describeRequirements(req), [
    'No connector in this space matches salesforce',
    'No node type in this space matches invoice',
    'No agent in this space matches deal-*',
  ])
})

test('a satisfied tool describes nothing, so the list can render unconditionally', () => {
  assert.deepEqual(describeRequirements({ connectors: [], types: [], agents: [] }), [])
})

// ── snapshot comparison and decoding ──

test('requirementsEqual ignores order but not membership', () => {
  const a: ToolRequirements = { connectors: ['a', 'b'], types: [], agents: [] }
  assert.equal(requirementsEqual(a, { connectors: ['b', 'a'], types: [], agents: [] }), true)
  assert.equal(requirementsEqual(a, { connectors: ['a'], types: [], agents: [] }), false)
  assert.equal(requirementsEqual(a, { connectors: ['a', 'c'], types: [], agents: [] }), false)
  assert.equal(requirementsEqual(a, { connectors: ['a', 'b'], types: ['x'], agents: [] }), false)
})

test('parseRequirements reads a stored snapshot and shrugs off anything else', () => {
  assert.deepEqual(parseRequirements({ connectors: ['hubspot'], types: [], agents: [] }), {
    connectors: ['hubspot'],
    types: [],
    agents: [],
  })
  // A row written before a dimension existed reads as "nothing missing there".
  assert.deepEqual(parseRequirements({ connectors: ['hubspot'] }), {
    connectors: ['hubspot'],
    types: [],
    agents: [],
  })
  for (const junk of [null, undefined, 'nope', 42, [], { connectors: 'hubspot' }]) {
    assert.deepEqual(parseRequirements(junk), { connectors: [], types: [], agents: [] }, String(junk))
  }
  assert.deepEqual(parseRequirements({ connectors: ['ok', '', 3, null] }), {
    connectors: ['ok'],
    types: [],
    agents: [],
  })
})
