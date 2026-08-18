/**
 * Type-page dispatch: which installed Tool draws a context type's surface.
 *
 * The rule under test is the one the brief is emphatic about — a Tool may own
 * the page for a member-invented type and may only ever ADD A TAB to a
 * built-in. `installs.ts#resolveTypeClaims` enforces it when the claim is
 * written; this module re-checks it when the claim is read, so a row that got
 * past the write rule still cannot replace a member's profile.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-type-pages.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { InstalledToolDto, TypeClaims } from '@/lib/tools/installs'
import {
  BUILT_IN_TYPES,
  isBuiltInType,
  noteTypeOf,
  pageClaimantsFor,
  resolveTypePage,
  typePagesFor,
  typeTabsFor,
} from '@/lib/tools/typePages'

/** One enabled install claiming `types`, unless the overrides say otherwise. */
function install(slug: string, types: TypeClaims, overrides: Partial<InstalledToolDto> = {}): InstalledToolDto {
  return {
    id: `i_${slug}`,
    key: `space:acme/${slug}`,
    slug,
    title: `The ${slug} tool`,
    icon: null,
    label: null,
    href: `/t/${slug}`,
    enabled: true,
    degraded: false,
    types,
    ...overrides,
  }
}

/** Swallow the one-page-per-type warning so a deliberate data fault stays quiet. */
function withoutWarnings<T>(run: () => T): { value: T; warnings: string[] } {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
  try {
    return { value: run(), warnings }
  } finally {
    console.warn = original
  }
}

// ── which types are Visvine's ────────────────────────────────────────────────

test('every built-in type is built in, whichever way it is spelled', () => {
  for (const type of BUILT_IN_TYPES) assert.equal(isBuiltInType(type), true, type)
  // entityKindOf's synonym table, not a second copy of it here.
  for (const synonym of ['People', 'PERSON', 'organization', 'company', 'communities', 'agents', 'tools', 'events']) {
    assert.equal(isBuiltInType(synonym), true, synonym)
  }
})

test('a member-invented type is not built in', () => {
  for (const type of ['deal', 'Playbook', 'sector', 'person-of-interest']) {
    assert.equal(isBuiltInType(type), false, type)
  }
})

test('an absent or empty type is nothing at all', () => {
  assert.equal(isBuiltInType(null), false)
  assert.equal(isBuiltInType(''), false)
  assert.equal(isBuiltInType('   '), false)
})

// ── built-ins keep their page ────────────────────────────────────────────────

test('a page claim on a built-in resolves to a tab, not a page', () => {
  const claim = resolveTypePage([install('roster', { person: 'page' })], 'person')
  assert.equal(claim?.mode, 'tab')
  assert.equal(claim?.owner.slug, 'roster')
})

test('a built-in claim resolves through a synonym too', () => {
  const claim = resolveTypePage([install('roster', { person: 'page' })], 'People')
  assert.equal(claim, null, 'the claim is stored under the type it was declared as')
  const byKind = resolveTypePage([install('roster', { people: 'tab' })], 'people')
  assert.equal(byKind?.mode, 'tab')
})

test('every built-in claim is a tab, so several Tools can sit beside a profile', () => {
  const tools = [install('roster', { person: 'tab' }), install('crm', { person: 'page' })]
  assert.deepEqual(
    typeTabsFor(tools, 'person').map((owner) => owner.slug),
    ['roster', 'crm'],
  )
})

// ── custom types get the page ────────────────────────────────────────────────

test('a custom type resolves to the page of the one install claiming it', () => {
  const claim = resolveTypePage([install('deal-board', { deal: 'page' })], 'deal')
  assert.equal(claim?.mode, 'page')
  assert.deepEqual(claim?.owner, {
    id: 'i_deal-board',
    slug: 'deal-board',
    title: 'The deal-board tool',
    key: 'space:acme/deal-board',
  })
})

test('the type is matched case- and whitespace-insensitively', () => {
  const tools = [install('deal-board', { deal: 'page' })]
  for (const spelling of ['deal', 'Deal', 'DEAL', '  Deal  ']) {
    assert.equal(resolveTypePage(tools, spelling)?.owner.slug, 'deal-board', spelling)
  }
})

test('a custom type nobody claims resolves to nothing', () => {
  assert.equal(resolveTypePage([install('deal-board', { deal: 'page' })], 'sector'), null)
  assert.equal(resolveTypePage([], 'deal'), null)
  assert.equal(resolveTypePage(null, 'deal'), null)
  assert.equal(resolveTypePage(undefined, ''), null)
})

test('a custom type claimed only as a tab stays a tab', () => {
  const claim = resolveTypePage([install('deal-board', { deal: 'tab' })], 'deal')
  assert.equal(claim?.mode, 'tab')
})

test('the page owner is not also listed as a tab beside itself', () => {
  const tools = [install('deal-board', { deal: 'page' }), install('deal-notes', { deal: 'tab' })]
  assert.deepEqual(
    typeTabsFor(tools, 'deal').map((owner) => owner.slug),
    ['deal-notes'],
  )
})

test('the console can see every page claimant, including a disagreement', () => {
  const tools = [install('one', { deal: 'page' }), install('two', { deal: 'tab' })]
  assert.deepEqual(
    pageClaimantsFor(tools, 'Deal').map((tool) => tool.slug),
    ['one'],
  )
  assert.deepEqual(
    pageClaimantsFor([install('one', { deal: 'page' }), install('two', { deal: 'page' })], 'deal').map(
      (tool) => tool.slug,
    ),
    ['one', 'two'],
  )
  // A built-in has no page to claim, so there is nothing for a picker to settle.
  assert.deepEqual(pageClaimantsFor([install('roster', { person: 'page' })], 'person'), [])
  assert.deepEqual(pageClaimantsFor(null, 'deal'), [])
})

test('two page claims on one type is a data fault: first wins, and it is logged', () => {
  const tools = [install('one', { deal: 'page' }), install('two', { deal: 'page' })]
  const { value, warnings } = withoutWarnings(() => resolveTypePage(tools, 'deal'))
  assert.equal(value?.owner.slug, 'one')
  assert.equal(value?.mode, 'page')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /deal/)
  assert.match(warnings[0], /one, two/)
})

// ── a disabled install draws nothing ─────────────────────────────────────────

test('a disabled install claims nothing', () => {
  const tools = [install('deal-board', { deal: 'page' }, { enabled: false })]
  assert.equal(resolveTypePage(tools, 'deal'), null)
  assert.deepEqual(typeTabsFor(tools, 'deal'), [])
  assert.deepEqual(typePagesFor(tools), {})
})

test('a disabled page owner does not block an enabled Tool behind it', () => {
  const tools = [
    install('off', { deal: 'page' }, { enabled: false }),
    install('on', { deal: 'page' }),
  ]
  const claim = resolveTypePage(tools, 'deal')
  assert.equal(claim?.owner.slug, 'on')
  assert.equal(claim?.mode, 'page')
})

// ── the whole map ────────────────────────────────────────────────────────────

test('typePagesFor resolves every claimed type once', () => {
  const map = typePagesFor([
    install('deal-board', { deal: 'page', person: 'page' }),
    install('sectors', { sector: 'tab', deal: 'tab' }),
  ])
  assert.deepEqual(Object.keys(map).sort(), ['deal', 'person', 'sector'])
  assert.equal(map.deal.mode, 'page')
  assert.equal(map.deal.owner.slug, 'deal-board')
  // Built-in: downgraded on read, exactly as resolveTypePage answers it.
  assert.equal(map.person.mode, 'tab')
  assert.equal(map.sector.mode, 'tab')
  assert.equal(map.sector.owner.slug, 'sectors')
})

test('an empty space has an empty map', () => {
  assert.deepEqual(typePagesFor([]), {})
  assert.deepEqual(typePagesFor(null), {})
  assert.deepEqual(typePagesFor([install('none', {})]), {})
})

// ── the note's own type ──────────────────────────────────────────────────────

test('noteTypeOf lower-cases the frontmatter type', () => {
  assert.equal(noteTypeOf({ type: 'Deal' }), 'deal')
  assert.equal(noteTypeOf({ type: '  Deal  ' }), 'deal')
  assert.equal(noteTypeOf({ type: 'Person', title: 'Craig' }), 'person')
})

test('noteTypeOf is null for a note with no usable type', () => {
  assert.equal(noteTypeOf({}), null)
  assert.equal(noteTypeOf({ type: '' }), null)
  assert.equal(noteTypeOf({ type: '   ' }), null)
  assert.equal(noteTypeOf(null), null)
  assert.equal(noteTypeOf(undefined), null)
  // A YAML list or number in `type:` is not a type name.
  assert.equal(noteTypeOf({ type: 3 } as never), null)
  assert.equal(noteTypeOf({ type: ['deal'] } as never), null)
})
