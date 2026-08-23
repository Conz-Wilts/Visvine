/**
 * Where an installed Tool lands in the sidebar — the two pure halves of the
 * rail: which installs earn a row (features/tools/lib/railRows.ts) and where
 * those rows sit (lib/featureAccess.ts#navFeatureKeys).
 *
 * features/shared/lib/features.tsx composes them and adds the icon; it carries
 * JSX and so cannot be imported here, which is exactly why the rule lives in
 * these two modules and not in that one.
 *
 * The thing under test is that a `tool:<slug>` row is NOT a special case: it
 * sorts, tucks into "More" and hides behind an admin lock by the same rules a
 * built-in does. The one rule specific to Tools is where an unplaced key falls —
 * after the built-in rows, because the first visible row is the tab members land
 * on and installing a Tool must never move a space's front door.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-rail.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SpaceFeatureConfig } from '@/lib/types'
import type { InstalledToolDto } from '@/lib/tools/installs'
import { navFeatureKeys, toolRailKey } from '@/lib/featureAccess'
import { toolRailRows } from '@/features/tools/lib/railRows'

/** One enabled install with a rail surface, unless the overrides say otherwise. */
function install(slug: string, overrides: Partial<InstalledToolDto> = {}): InstalledToolDto {
  return {
    id: `i_${slug}`,
    key: `space:acme/${slug}`,
    slug,
    title: `The ${slug} tool`,
    icon: 'kanban',
    iconSvg: null,
    label: slug,
    href: `/t/${slug}`,
    enabled: true,
    degraded: false,
    types: {},
    ...overrides,
  }
}

/** The rail/More split for a space running `tools`, as the Sidebar computes it. */
function nav(
  config: SpaceFeatureConfig | null,
  isAdmin: boolean,
  tools: InstalledToolDto[] = [],
): { rail: string[]; more: string[] } {
  return navFeatureKeys(config, isAdmin, toolRailRows(tools).map((row) => row.key))
}

/** The built-in rail keys, in registry order — what a member of a fresh space sees. */
const BUILT_IN_RAIL = ['directory', 'channels', 'resources', 'agents']

// ── which installs earn a row ────────────────────────────────────────────────

test('an enabled install with a rail surface earns one row, keyed and linked', () => {
  const [row] = toolRailRows([install('deals', { label: 'Deals', title: 'Deal Pipeline' })])
  assert.equal(row.key, 'tool:deals')
  assert.equal(row.key, toolRailKey('deals'))
  assert.equal(row.label, 'Deals')
  assert.equal(row.title, 'Deal Pipeline')
  assert.equal(row.href, '/t/deals')
  assert.equal(row.icon, 'kanban')
  assert.equal(row.degraded, false)
})

test('a tool that only owns a type page earns no rail row', () => {
  // installedToolsForClient reports label/icon null when the Tool declared no
  // `rail` surface — there is no /t/<slug> page behind it to link to.
  assert.deepEqual(toolRailRows([install('typed', { label: null, icon: null })]), [])
})

test('a disabled install earns no rail row', () => {
  assert.deepEqual(toolRailRows([install('deals', { enabled: false })]), [])
})

test('a rail row declared without a label falls back to the tool’s title', () => {
  const [row] = toolRailRows([install('deals', { label: '', title: 'Deal Pipeline' })])
  assert.equal(row.label, 'Deal Pipeline')
})

test('no installs at all is no rows, however the space DTO says so', () => {
  assert.deepEqual(toolRailRows([]), [])
  assert.deepEqual(toolRailRows(null), [])
  assert.deepEqual(toolRailRows(undefined), [])
})

test('rows keep the order the space DTO gave them, and a degraded install says so', () => {
  const rows = toolRailRows([install('deals', { degraded: true }), install('board')])
  assert.deepEqual(rows.map((r) => r.slug), ['deals', 'board'])
  assert.deepEqual(rows.map((r) => r.degraded), [true, false])
})

// ── where the rows sit ───────────────────────────────────────────────────────

test('with no installs the rail is exactly the built-in rows', () => {
  assert.deepEqual(nav(null, false).rail, BUILT_IN_RAIL)
  assert.deepEqual(nav(null, false).more, [])
  // `connectors` is admins-only by nature, so it is a rail row for an admin only.
  assert.equal(nav(null, true).rail.includes('connectors'), true)
})

test('an unplaced tool falls in after the built-in rows, not in front of them', () => {
  assert.deepEqual(nav(null, false, [install('deals')]).rail, [...BUILT_IN_RAIL, 'tool:deals'])
})

test('two unplaced tools keep the order the space DTO gave them', () => {
  assert.deepEqual(nav(null, false, [install('deals'), install('board')]).rail, [
    ...BUILT_IN_RAIL,
    'tool:deals',
    'tool:board',
  ])
})

test('featureConfig.order places a tool exactly like a built-in', () => {
  const config: SpaceFeatureConfig = { order: ['tool:deals', 'directory', 'channels'] }
  const { rail } = nav(config, false, [install('deals')])
  assert.deepEqual(rail.slice(0, 3), ['tool:deals', 'directory', 'channels'])
  // The rest fall in behind, in registry order — sortFeatureKeys' rule, unchanged.
  assert.deepEqual(rail.slice(3), ['resources', 'agents'])
})

test('a tool key in `more` is tucked into the popup and off the rail', () => {
  const config: SpaceFeatureConfig = { order: ['directory', 'tool:deals', 'channels'], more: ['tool:deals'] }
  const { rail, more } = nav(config, false, [install('deals')])
  assert.equal(rail.includes('tool:deals'), false)
  assert.deepEqual(more, ['tool:deals'])
})

test('More membership is a set; the order still comes from `order`', () => {
  const config: SpaceFeatureConfig = {
    order: ['tool:board', 'directory', 'tool:deals'],
    more: ['tool:deals', 'tool:board'],
  }
  assert.deepEqual(nav(config, false, [install('deals'), install('board')]).more, ['tool:board', 'tool:deals'])
})

test('members see installed tools; an explicit admin lock still hides one', () => {
  const tools = [install('deals')]
  assert.equal(nav(null, false, tools).rail.includes('tool:deals'), true)

  const locked: SpaceFeatureConfig = { adminOnly: ['tool:deals'] }
  assert.equal(nav(locked, false, tools).rail.includes('tool:deals'), false)
  assert.equal(nav(locked, true, tools).rail.includes('tool:deals'), true)
})

test('switching a tool off in featureConfig.enabled drops its row', () => {
  const config: SpaceFeatureConfig = { enabled: { 'tool:deals': false } }
  assert.equal(nav(config, false, [install('deals')]).rail.includes('tool:deals'), false)
})

test('a stored `tools: false` no longer drops installed Tool rows — the key is core', () => {
  // Written before `tools` became core, such a config must be ignored: what a
  // space runs is decided by review + install, and an install that exists IS
  // that decision. Its row therefore stays for everyone.
  const config: SpaceFeatureConfig = {
    enabled: { tools: false },
    order: ['tool:deals', 'directory'],
  }
  const tools = [install('deals')]
  assert.equal(nav(config, false, tools).rail.includes('tool:deals'), true)
  assert.equal(nav(config, true, tools).rail.includes('tool:deals'), true)
})

test('nav-hidden keys never become rows, the tool vocabulary included', () => {
  const { rail, more } = nav({ more: ['notes', 'events', 'tools'] }, true, [install('deals')])
  for (const hidden of ['notes', 'events', 'tools']) {
    assert.equal([...rail, ...more].includes(hidden), false, `${hidden} must not be a nav row`)
  }
  assert.equal(rail.includes('tool:deals'), true)
})

test('an install placed in `order` but since uninstalled leaves no row behind', () => {
  // The stored key outlives the client's view of the install for a moment after
  // an uninstall; nothing may render for it.
  const config: SpaceFeatureConfig = { order: ['tool:gone', 'directory'], more: ['tool:gone'] }
  const { rail, more } = nav(config, true, [])
  assert.equal([...rail, ...more].includes('tool:gone'), false)
  assert.equal(rail[0], 'directory')
})
