/**
 * A Tool inside the app's shell: its own sections and band buttons
 * (`surfaces.nav`, `surfaces.actions` in lib/tools/config.ts), how a change to
 * either is reviewed (registry.ts#surfacesUnchanged), where its rail row is
 * placed at install (installs.ts#featureConfigWithRail), which of its type
 * claims an admin kept (installs.ts#requestedClaims), and the three messages
 * that carry a section and a band press across the frame boundary.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-shell-nav.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseToolBandActions,
  parseToolConfig,
  parseToolNav,
  TOOL_BAND_ACTIONS_MAX,
  TOOL_NAV_TABS_MAX,
  type ToolConfig,
} from '@/lib/tools/config'
import { surfacesUnchanged } from '@/lib/tools/registry'
import { featureConfigWithRail, orderWithRail, requestedClaims } from '@/lib/tools/installs'
import { isFrameMessage, isHostMessage, PROTOCOL_VERSION, type ToolInitMessage } from '@/lib/tools/protocol'
import { createBridgeClient } from '@/features/tools/kit/client'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

// ── surfaces.nav ─────────────────────────────────────────────────────────────

test('nav defaults to tabs, lower-cases ids and keeps the admin flag', () => {
  const parsed = parseToolNav({
    sections: [
      { id: 'Board', label: 'Board' },
      { id: 'settings', label: 'Settings', admin: true },
    ],
  })
  assert.deepEqual(parsed, {
    ok: true,
    nav: {
      style: 'tabs',
      sections: [
        { id: 'board', label: 'Board' },
        { id: 'settings', label: 'Settings', admin: true },
      ],
    },
  })
})

test('no nav is null, not an empty list', () => {
  assert.deepEqual(parseToolNav(undefined), { ok: true, nav: null })
  assert.deepEqual(parseToolNav(null), { ok: true, nav: null })
  assert.deepEqual(parseToolNav(false), { ok: true, nav: null })
})

test('the band holds a handful of tabs; more is a side list', () => {
  const many = Array.from({ length: TOOL_NAV_TABS_MAX + 1 }, (_, i) => ({ id: `s${i}`, label: `S${i}` }))
  const tabs = parseToolNav({ style: 'tabs', sections: many })
  assert.equal(tabs.ok, false)
  assert.match(!tabs.ok ? tabs.error : '', /style: side/)
  const side = parseToolNav({ style: 'side', sections: many })
  assert.equal(side.ok && side.nav?.sections.length, TOOL_NAV_TABS_MAX + 1)
})

test('a nav refuses a bad style, a bad or repeated id, and a label that explains', () => {
  const bad = (raw: unknown) => {
    const parsed = parseToolNav(raw)
    assert.equal(parsed.ok, false, JSON.stringify(raw))
    return parsed.ok ? '' : parsed.error
  }
  assert.match(bad({ style: 'grid', sections: [] }), /tabs or side/)
  assert.match(bad({ sections: 'board' }), /must be a list/)
  assert.match(bad(['board']), /must be a map/)
  assert.match(bad({ sections: [{ id: 'has space', label: 'X' }] }), /Bad section id/)
  assert.match(bad({ sections: [{ id: '../up', label: 'X' }] }), /Bad section id/)
  assert.match(
    bad({
      sections: [
        { id: 'a', label: 'A' },
        { id: 'A', label: 'B' },
      ],
    }),
    /declared twice/,
  )
  assert.match(bad({ sections: [{ id: 'a' }] }), /needs a label/)
  assert.match(bad({ sections: [{ id: 'a', label: 'Everything you need to know' }] }), /one to three words/)
  assert.match(bad({ sections: ['a'] }), /\{ id, label \}/)
})

// ── surfaces.actions ─────────────────────────────────────────────────────────

test('band actions: at most two, each { id, label }, no repeats', () => {
  assert.deepEqual(parseToolBandActions(undefined), { ok: true, actions: [] })
  assert.deepEqual(parseToolBandActions([{ id: 'New-Deal', label: 'New deal' }]), {
    ok: true,
    actions: [{ id: 'new-deal', label: 'New deal' }],
  })
  const three = Array.from({ length: TOOL_BAND_ACTIONS_MAX + 1 }, (_, i) => ({ id: `a${i}`, label: `A${i}` }))
  assert.equal(parseToolBandActions(three).ok, false)
  assert.equal(parseToolBandActions({ id: 'a', label: 'A' }).ok, false)
  assert.equal(
    parseToolBandActions([
      { id: 'a', label: 'A' },
      { id: 'a', label: 'B' },
    ]).ok,
    false,
  )
  assert.equal(parseToolBandActions([{ id: 'a', label: '' }]).ok, false)
  assert.equal(parseToolBandActions([null]).ok, false)
})

test('the index note carries nav and actions through parseToolConfig', () => {
  const frontmatter = parseFrontmatter(
    [
      '---',
      'type: tool',
      'title: Deal Pipeline',
      'description: Deals by stage',
      'surfaces:',
      '  rail: { label: Deals, icon: kanban }',
      '  nav:',
      '    style: side',
      '    sections:',
      '      - { id: board, label: Board }',
      '      - { id: table, label: Table }',
      '      - { id: settings, label: Settings, admin: true }',
      '  actions:',
      '    - { id: new-deal, label: New deal }',
      '---',
      '',
    ].join('\n'),
  )
  const parsed = parseToolConfig(frontmatter, 'deal-pipeline')
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  assert.equal(parsed.config.surfaces.nav?.style, 'side')
  assert.deepEqual(
    parsed.config.surfaces.nav?.sections.map((s) => s.id),
    ['board', 'table', 'settings'],
  )
  assert.deepEqual(parsed.config.surfaces.actions, [{ id: 'new-deal', label: 'New deal' }])
})

test('a bad nav fails the whole index note, naming the key', () => {
  const frontmatter = parseFrontmatter(
    ['---', 'type: tool', 'title: X', 'surfaces:', '  nav: { style: grid, sections: [] }', '---', ''].join('\n'),
  )
  const parsed = parseToolConfig(frontmatter, 'x')
  assert.equal(parsed.ok, false)
  assert.match(parsed.ok ? '' : parsed.error, /surfaces\.nav\.style/)
})

// ── review: the band is new real estate ─────────────────────────────────────

test('a changed section, band button or nav style is a surface change', () => {
  const base: ToolConfig['surfaces'] = {
    rail: { label: 'Deals', icon: 'kanban' },
    types: [],
    nav: { style: 'tabs', sections: [{ id: 'board', label: 'Board' }] },
    actions: [{ id: 'new-deal', label: 'New deal' }],
  }
  assert.equal(surfacesUnchanged(base, structuredClone(base)), true)
  assert.equal(surfacesUnchanged(base, { ...base, nav: { ...base.nav!, style: 'side' } }), false)
  assert.equal(
    surfacesUnchanged(base, { ...base, nav: { style: 'tabs', sections: [{ id: 'board', label: 'Pipeline' }] } }),
    false,
  )
  assert.equal(
    surfacesUnchanged(base, {
      ...base,
      nav: { style: 'tabs', sections: [{ id: 'board', label: 'Board', admin: true }] },
    }),
    false,
  )
  assert.equal(surfacesUnchanged(base, { ...base, actions: [] }), false)
  assert.equal(surfacesUnchanged(base, { ...base, nav: null }), false)
  // A version written before sections and buttons reads the same as one declaring none.
  assert.equal(surfacesUnchanged({ rail: null, types: [] }, { rail: null, types: [], nav: null, actions: [] }), true)
})

// ── placement ────────────────────────────────────────────────────────────────

test('a Tool placed on the rail joins the order and is switched on', () => {
  const next = featureConfigWithRail({ order: ['directory', 'channels'] }, 'tool:deals')
  assert.deepEqual(next.order, ['directory', 'channels', 'tool:deals'])
  assert.equal(next.enabled?.['tool:deals'], true)
  assert.equal(next.more, undefined)
})

test('a Tool placed in More is tucked there, once', () => {
  const next = featureConfigWithRail({ order: ['directory'], more: ['channels'] }, 'tool:deals', 'more')
  assert.deepEqual(next.more, ['channels', 'tool:deals'])
  assert.deepEqual(next.order, ['directory', 'tool:deals'])
  const again = featureConfigWithRail(next, 'tool:deals', 'more')
  assert.deepEqual(again.more, ['channels', 'tool:deals'])
})

test('re-installing onto the rail takes it back out of More', () => {
  const next = featureConfigWithRail({ order: ['directory', 'tool:deals'], more: ['tool:deals'] }, 'tool:deals', 'rail')
  assert.equal(next.more?.includes('tool:deals') ?? false, false)
})

test('placing a Tool never moves the front door: an empty order is the registry order first', () => {
  const order = orderWithRail({}, 'tool:deals')
  assert.equal(order[order.length - 1], 'tool:deals')
  assert.notEqual(order[0], 'tool:deals')
})

// ── type claims ──────────────────────────────────────────────────────────────

test('an admin keeps, changes or declines each declared type claim', () => {
  const declared = [
    { type: 'deal', mode: 'page' as const },
    { type: 'company', mode: 'tab' as const },
    { type: 'person', mode: 'tab' as const },
  ]
  assert.deepEqual(requestedClaims(declared, undefined), declared)
  assert.deepEqual(requestedClaims(declared, { deal: 'tab', person: 'none' }), [
    { type: 'deal', mode: 'tab' },
    { type: 'company', mode: 'tab' },
  ])
  // An answer about a type the Tool never declared claims nothing.
  assert.deepEqual(requestedClaims(declared, { event: 'page' }), declared)
})

// ── the wire ─────────────────────────────────────────────────────────────────

test('the section and the band press are well-formed messages, and nothing else is', () => {
  assert.equal(isHostMessage({ type: 'visvine:route', section: 'board' }), true)
  assert.equal(isHostMessage({ type: 'visvine:route', section: null }), true)
  assert.equal(isHostMessage({ type: 'visvine:route' }), false)
  assert.equal(isHostMessage({ type: 'visvine:action', id: 'new-deal' }), true)
  assert.equal(isHostMessage({ type: 'visvine:action', id: 7 }), false)
  assert.equal(isFrameMessage({ type: 'visvine:section', section: 'board' }), true)
  assert.equal(isFrameMessage({ type: 'visvine:section', section: 'x'.repeat(33) }), false)
  assert.equal(isFrameMessage({ type: 'visvine:section', section: 3 }), false)
})

const PARENT = 'https://visvine.com'

class FakeWindow {
  readonly sent: unknown[] = []
  readonly listeners = new Set<(event: MessageEvent) => void>()
  readonly parent = { postMessage: (message: unknown) => void this.sent.push(message) }
  addEventListener(_type: string, fn: (event: MessageEvent) => void): void {
    this.listeners.add(fn)
  }
  removeEventListener(_type: string, fn: (event: MessageEvent) => void): void {
    this.listeners.delete(fn)
  }
  deliver(data: unknown, origin: string = PARENT): void {
    for (const fn of [...this.listeners]) fn({ data, origin } as MessageEvent)
  }
}

const INIT: ToolInitMessage = {
  type: 'visvine:init',
  version: PROTOCOL_VERSION,
  theme: {},
  subject: null,
  install: { slug: 'deals', title: 'Deals', key: 'tool:deals' },
  degraded: null,
  viewer: { id: 'u1', name: 'Ada', isAdmin: false },
  section: 'board',
}

test('the kit hears a route and a band press from the host, and asks for a section', () => {
  const win = new FakeWindow()
  const client = createBridgeClient(win as unknown as Window, PARENT)
  const routes: Array<string | null> = []
  const actions: string[] = []
  client.onRoute((section) => routes.push(section))
  const offAction = client.onAction((id) => actions.push(id))
  win.deliver(INIT)
  win.deliver({ type: 'visvine:route', section: 'table' })
  win.deliver({ type: 'visvine:route', section: null })
  win.deliver({ type: 'visvine:action', id: 'new-deal' })
  // Anyone else's window at another origin is not the host.
  win.deliver({ type: 'visvine:action', id: 'forged' }, 'https://evil.example')
  win.deliver({ type: 'visvine:route', section: 42 })
  offAction()
  win.deliver({ type: 'visvine:action', id: 'after-unsubscribe' })
  assert.deepEqual(routes, ['table', null])
  assert.deepEqual(actions, ['new-deal'])
  client.section('settings')
  assert.deepEqual(win.sent[win.sent.length - 1], { type: 'visvine:section', section: 'settings' })
  client.close()
})
