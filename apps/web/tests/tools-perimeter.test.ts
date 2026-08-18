/**
 * The Tool perimeter (lib/tools/perimeter.ts): glob semantics, both directions
 * of every gate, the upgrade diff, and the review bullets.
 *
 * The gates are asserted both ways on purpose — a gate that always refuses looks
 * identical to a working one until something is meant to be allowed.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-perimeter.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describePerimeter,
  diffPerimeter,
  EMPTY_PERIMETER,
  globMatch,
  isValidGlobEntry,
  parseToolPerimeter,
  perimeterIsEmpty,
  refuseAgent,
  refuseConnector,
  refuseRead,
  refuseType,
  refuseWrite,
  type ToolPerimeter,
} from '@/lib/tools/perimeter'

function perimeter(over: Partial<ToolPerimeter> = {}): ToolPerimeter {
  return { ...EMPTY_PERIMETER, ...over }
}

// ── globs ──

test('** crosses segments, * stays inside one', () => {
  assert.ok(globMatch('deals/**', 'deals/a/b.md'))
  assert.ok(globMatch('deals/**', 'deals/x.md'))
  assert.ok(!globMatch('deals/**', 'dealsx/a.md'), 'the segment boundary is not a prefix match')
  assert.ok(!globMatch('deals/**', 'deals'), 'the folder itself is not a note')

  assert.ok(globMatch('people/*/index.md', 'people/ana/index.md'))
  assert.ok(!globMatch('people/*/index.md', 'people/ana/notes/index.md'))
  assert.ok(!globMatch('people/*/index.md', 'people/index.md'))
  assert.ok(!globMatch('people/*/index.md', 'people/ana/notes.md'))
})

test('a middle ** matches any depth including none', () => {
  assert.ok(globMatch('people/**/index.md', 'people/index.md'))
  assert.ok(globMatch('people/**/index.md', 'people/ana/index.md'))
  assert.ok(globMatch('people/**/index.md', 'people/ana/notes/index.md'))
  assert.ok(!globMatch('people/**/index.md', 'people/ana/notes.md'))
})

test('a trailing slash means that folder and everything below it', () => {
  assert.ok(globMatch('deals/', 'deals/x.md'))
  assert.ok(globMatch('deals/', 'deals/a/b.md'))
  assert.ok(globMatch('deals/', 'deals/index.md'))
  assert.ok(!globMatch('deals/', 'dealsx/a.md'))
})

test('** alone matches everything, and nothing matches nothing', () => {
  for (const path of ['index.md', 'deals/x.md', 'people/ana/notes/deep.md']) {
    assert.ok(globMatch('**', path), path)
  }
  assert.ok(!globMatch('', 'deals/x.md'))
  assert.ok(!globMatch('deals/**', ''))
})

test('a leading slash on either side is not a difference', () => {
  assert.ok(globMatch('/deals/**', 'deals/x.md'))
  assert.ok(globMatch('deals/**', '/deals/x.md'))
})

test('within-segment stars match partial names, and the extension is not special', () => {
  assert.ok(globMatch('deals/q*-review.md', 'deals/q3-review.md'))
  assert.ok(!globMatch('deals/q*-review.md', 'deals/q3/review.md'))
  assert.ok(globMatch('deals/*.md', 'deals/x.md'))
  assert.ok(!globMatch('deals/*.md', 'deals/x.csv'))
})

test('a traversal segment in the subject never matches, however permissive the glob', () => {
  for (const path of [
    'deals/../people/secret.md',
    'deals/../../etc/passwd',
    'deals/a/../../salaries.md',
    '/deals/../secret.md',
    'deals\\..\\x.md',
  ]) {
    assert.ok(!globMatch('deals/**', path), path)
    assert.ok(!globMatch('**', path), path)
  }
})

test('refuseRead and refuseWrite refuse a traversal subject with a distinct message', () => {
  const p = perimeter({ read: ['deals/**'], write: ['deals/**'] })
  for (const path of [
    'deals/../people/secret.md',
    'deals/../../etc/passwd',
    'deals/a/../../salaries.md',
    '/deals/../secret.md',
    'deals\\..\\x.md',
  ]) {
    assert.match(String(refuseRead(p, path)), /^tool perimeter denied: .* is not a valid context path$/, path)
    assert.match(String(refuseWrite(p, path)), /^tool perimeter denied: .* is not a valid context path$/, path)
  }
  assert.equal(refuseRead(p, 'deals/ok.md'), null)
  assert.equal(refuseRead(p, 'deals/a/b/c.md'), null)
  assert.equal(refuseRead(p, '/deals/ok.md'), null, 'a legitimate leading slash still normalises and passes')
})

// ── catastrophic backtracking ──

test('consecutive ** segments compile fast and still match everything below', () => {
  // The exact shape that measured 141s before the fix: many adjacent `**`
  // segments in a row, matched against a subject deep enough that a
  // backtracking regex would explore every split point between them.
  const pathological = '**/'.repeat(14) + 'zzz.md'
  const subject = 'a/'.repeat(24) + 'zzz.md'
  const start = performance.now()
  const matched = globMatch(pathological, subject)
  const elapsed = performance.now() - start
  assert.ok(matched, 'zzz.md at the end still matches through the collapsed **')
  assert.ok(elapsed < 100, `took ${elapsed}ms — consecutive ** must collapse to one group`)

  const noMatch = globMatch(pathological, 'a/'.repeat(24) + 'other.md')
  assert.ok(!noMatch)
})

test('a glob with more ** groups than the cap never matches, and stays fast', () => {
  // Collapsing does not help here — none of the three `**` are adjacent — so
  // this relies on the hard cap in globRegExp's isGlobPatternSafe backstop.
  const pathological = '**/a*/**/a*/**/x'
  const subject = 'a/'.repeat(24) + 'x'
  const start = performance.now()
  const matched = globMatch(pathological, subject)
  const elapsed = performance.now() - start
  assert.equal(matched, false, 'a pattern over the ** cap is treated as unmatchable, not compiled')
  assert.ok(elapsed < 100, `took ${elapsed}ms`)
})

test('refuseRead on a many-** perimeter entry returns promptly', () => {
  const p = perimeter({ read: ['**/'.repeat(14) + 'zzz.md'] })
  const subject = 'a/'.repeat(24) + 'index.md'
  const start = performance.now()
  refuseRead(p, subject)
  const elapsed = performance.now() - start
  assert.ok(elapsed < 100, `took ${elapsed}ms`)
})

test('isValidGlobEntry accepts ordinary globs and refuses pathological ones', () => {
  assert.ok(isValidGlobEntry('deals/**'))
  assert.ok(isValidGlobEntry('people/*/index.md'))
  assert.ok(isValidGlobEntry('deals/'))
  assert.ok(!isValidGlobEntry(''))
  assert.ok(!isValidGlobEntry('deals/../secret.md'), 'traversal is still refused')
  assert.ok(!isValidGlobEntry('**/a*/**/a*/**/x'), 'too many ** groups')
  assert.ok(!isValidGlobEntry('a*a*a*a*b'), 'too many *s in one segment')
})

// ── parsing ──

test('parseToolPerimeter reads the frontmatter block', () => {
  const r = parseToolPerimeter({
    read: ['deals/**', 'people/*/index.md'],
    write: ['deals/**'],
    types: ['Deal'],
    connectors: ['hubspot'],
    agents: ['deal-*'],
  })
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) {
    assert.deepEqual(r.perimeter.read, ['deals/**', 'people/*/index.md'])
    assert.deepEqual(r.perimeter.write, ['deals/**'])
    assert.deepEqual(r.perimeter.types, ['deal'], 'type names are normalised lower-case')
    assert.deepEqual(r.perimeter.connectors, ['hubspot'])
    assert.deepEqual(r.perimeter.agents, ['deal-*'])
  }
})

test('a missing or empty block is a tool that declared nothing', () => {
  for (const raw of [undefined, null, {}]) {
    const r = parseToolPerimeter(raw)
    assert.ok(r.ok)
    if (r.ok) assert.equal(perimeterIsEmpty(r.perimeter), true)
  }
})

test('duplicate entries collapse', () => {
  const r = parseToolPerimeter({ read: ['deals/**', 'deals/**'], connectors: ['hubspot', 'HubSpot'] })
  assert.ok(r.ok)
  if (r.ok) {
    assert.deepEqual(r.perimeter.read, ['deals/**'])
    assert.deepEqual(r.perimeter.connectors, ['hubspot'])
  }
})

test('parseToolPerimeter says what is wrong instead of vanishing', () => {
  const cases: [unknown, RegExp][] = [
    ['deals/**', /`perimeter` must be a map/],
    [[], /`perimeter` must be a map/],
    [{ read: 'deals/**' }, /`perimeter\.read` must be a list/],
    [{ write: {} }, /`perimeter\.write` must be a list/],
    [{ read: [''] }, /Bad `perimeter\.read` entry/],
    [{ read: [42] }, /Bad `perimeter\.read` entry/],
    [{ read: ['../../etc/passwd'] }, /Bad `perimeter\.read` entry/],
    [{ read: ['deals/./x.md'] }, /Bad `perimeter\.read` entry/],
    [{ read: ['deals\\x.md'] }, /Bad `perimeter\.read` entry/],
    [{ read: ['**/a*/**/a*/**/x'] }, /too many wildcard segments/],
    [{ write: ['a*a*a*a*b'] }, /too many wildcard segments/],
    [{ types: 'deal' }, /`perimeter\.types` must be a list/],
    [{ types: ['deal!'] }, /Bad `perimeter\.types` entry/],
    [{ connectors: [''] }, /Bad `perimeter\.connectors` entry/],
    [{ agents: [{ name: 'x' }] }, /Bad `perimeter\.agents` entry/],
  ]
  for (const [raw, expected] of cases) {
    const r = parseToolPerimeter(raw)
    assert.equal(r.ok, false, JSON.stringify(raw))
    if (!r.ok) assert.match(r.error, expected)
  }
})

test('EMPTY_PERIMETER cannot be widened by a caller', () => {
  assert.throws(() => EMPTY_PERIMETER.read.push('**'))
  assert.equal(perimeterIsEmpty(EMPTY_PERIMETER), true)
})

// ── the gates ──

test('refuseRead allows a declared path and refuses the rest', () => {
  const p = perimeter({ read: ['deals/**', 'people/*/index.md'] })
  assert.equal(refuseRead(p, 'deals/acme/index.md'), null)
  assert.equal(refuseRead(p, 'people/ana/index.md'), null)
  const denial = refuseRead(p, 'salaries/x.md')
  assert.match(String(denial), /^tool perimeter denied: salaries\/x\.md is not in this tool's read globs \(deals\/\*\*, people\/\*\/index\.md\)$/)
})

test('a tool with no read globs is told exactly that', () => {
  assert.match(String(refuseRead(perimeter(), 'deals/x.md')), /this tool declares no read globs/)
})

test('write implies nothing about read, and read nothing about write', () => {
  const readOnly = perimeter({ read: ['deals/**'] })
  assert.equal(refuseRead(readOnly, 'deals/x.md'), null)
  assert.match(String(refuseWrite(readOnly, 'deals/x.md')), /declares no write globs/)

  const writeOnly = perimeter({ write: ['logs/**'] })
  assert.equal(refuseWrite(writeOnly, 'logs/run.md'), null)
  assert.match(String(refuseRead(writeOnly, 'logs/run.md')), /declares no read globs/)
  assert.match(String(refuseWrite(writeOnly, 'deals/x.md')), /is not in this tool's write globs \(logs\/\*\*\)/)
})

test('refuseType matches case-insensitively and honours * and prefix-*', () => {
  const p = perimeter({ types: ['deal'] })
  assert.equal(refuseType(p, 'deal'), null)
  assert.equal(refuseType(p, 'Deal'), null)
  assert.match(String(refuseType(p, 'person')), /person is not in this tool's types \(deal\)/)
  assert.match(String(refuseType(perimeter(), 'deal')), /declares no types/)

  assert.equal(refuseType(perimeter({ types: ['*'] }), 'anything'), null)
  const prefixed = perimeter({ types: ['deal-*'] })
  assert.equal(refuseType(prefixed, 'deal-stage'), null)
  assert.equal(refuseType(prefixed, 'deal-'), null)
  assert.ok(refuseType(prefixed, 'dealstage'))
})

test('refuseConnector and refuseAgent gate their own lists', () => {
  const p = perimeter({ connectors: ['hubspot'], agents: ['deal-*'] })
  assert.equal(refuseConnector(p, 'hubspot'), null)
  assert.match(String(refuseConnector(p, 'stripe')), /stripe is not in this tool's connectors \(hubspot\)/)
  assert.equal(refuseAgent(p, 'deal-digest'), null)
  assert.match(String(refuseAgent(p, 'payroll')), /payroll is not in this tool's agents \(deal-\*\)/)

  assert.match(String(refuseConnector(perimeter(), 'hubspot')), /declares no connectors/)
  assert.match(String(refuseAgent(perimeter(), 'deal-digest')), /declares no agents/)
})

test('one dimension does not leak into another', () => {
  const p = perimeter({ read: ['deals/**'], types: ['deal'], connectors: ['hubspot'], agents: ['deal-digest'] })
  assert.ok(refuseConnector(p, 'deal-digest'), 'an agent name is not a connector name')
  assert.ok(refuseAgent(p, 'hubspot'), 'a connector name is not an agent name')
  assert.ok(refuseType(p, 'deals/**'), 'a glob is not a type name')
})

// ── diff and description ──

test('diffPerimeter reports what an upgrade would change, per dimension', () => {
  const prev = perimeter({ read: ['deals/**'], write: ['deals/**'], types: ['deal'], connectors: ['hubspot'] })
  const next = perimeter({ read: ['deals/**', 'people/**'], types: ['deal'], agents: ['deal-*'] })
  const diff = diffPerimeter(prev, next)
  assert.deepEqual(diff.read, { added: ['people/**'], removed: [] })
  assert.deepEqual(diff.write, { added: [], removed: ['deals/**'] })
  assert.deepEqual(diff.types, { added: [], removed: [] })
  assert.deepEqual(diff.connectors, { added: [], removed: ['hubspot'] })
  assert.deepEqual(diff.agents, { added: ['deal-*'], removed: [] })
})

test('an unchanged perimeter diffs to nothing at all', () => {
  const p = perimeter({ read: ['deals/**'], write: ['deals/**'], types: ['deal'] })
  const diff = diffPerimeter(p, { ...p })
  for (const dimension of Object.values(diff)) {
    assert.deepEqual(dimension, { added: [], removed: [] })
  }
})

test('a glob rewritten to an equivalent one still shows as a change', () => {
  // `deals/` and `deals/**` cover the same notes, but they are different
  // declarations and a review that hid the edit would be lying to the admin.
  const diff = diffPerimeter(perimeter({ read: ['deals/'] }), perimeter({ read: ['deals/**'] }))
  assert.deepEqual(diff.read, { added: ['deals/**'], removed: ['deals/'] })
})

test('describePerimeter always states the data reach, and names the extras it has', () => {
  assert.deepEqual(describePerimeter(EMPTY_PERIMETER), [
    'Declares no reach — this tool reads and writes no space data',
  ])
  assert.deepEqual(describePerimeter(perimeter({ read: ['deals/**'] })), [
    'Reads deals/**',
    'Writes nothing',
  ])
  assert.deepEqual(
    describePerimeter(
      perimeter({ read: ['deals/**'], write: ['deals/**'], types: ['deal'], connectors: ['hubspot'], agents: ['deal-*'] }),
    ),
    [
      'Reads deals/**',
      'Writes deals/**',
      'Works with node types deal',
      'Calls connectors hubspot',
      'Runs agents deal-*',
    ],
  )
})
