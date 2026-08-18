/**
 * The marketplace registry and install libraries (lib/tools/registry.ts,
 * lib/tools/installs.ts): the decisions that have rules rather than rows —
 * version numbering, slug de-duplication, type-claim resolution and the
 * defensive decoding of the snapshot JSON columns.
 *
 * The database halves (publish, review, install, upgrade) are thin wrappers over
 * those decisions; they are exercised by the scripted end-to-end run, not from
 * here. What this file does assert about them is their shape, so a route written
 * against these modules is written against something checked.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-registry.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  browseVersions,
  decodeToolConfig,
  decodeToolPerimeter,
  getVersion,
  listReviewQueue,
  nextVersionNumber,
  perimeterDiffForVersion,
  publishTool,
  reviewVersion,
  toolKey,
  versionHistory,
  previousApprovedVersion,
  withdrawVersion,
  type BrowseEntry,
  type BrowsePage,
  type PublishResult,
  type RegistryError,
  type ReviewResult,
  type ToolVersionDetail,
  type ToolVersionStatus,
  type ToolVersionSummary,
  type VersionResult,
} from '@/lib/tools/registry'
import {
  applyUpgrade,
  installVersion,
  listInstalls,
  refreshRequirements,
  resolveTypeClaims,
  setInstallEnabled,
  setTypeClaims,
  uninstall,
  uniqueSlug,
  type InstallResult,
  type InstallSummary,
  type InstallUpdateResult,
  type InstalledToolDto,
  type RefreshResult,
  type TypeClaimConflict,
  type TypeClaimMode,
  type TypeClaimResolution,
  type TypeClaims,
  type UninstallResult,
} from '@/lib/tools/installs'
import { parseToolConfig, TOOL_NAME_RE, type ToolTypeSurface } from '@/lib/tools/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { EMPTY_PERIMETER } from '@/lib/tools/perimeter'

// ── version numbering ──

test('nextVersionNumber counts from one', () => {
  assert.equal(nextVersionNumber([]), 1)
})

test('nextVersionNumber goes one past the highest, gaps and all', () => {
  assert.equal(nextVersionNumber([1]), 2)
  assert.equal(nextVersionNumber([1, 2, 3]), 4)
  assert.equal(nextVersionNumber([3, 1, 2]), 4)
  // A rejected or withdrawn version still burns its number: (key, version) is
  // unique, and one number naming two snapshots is what immutability forbids.
  assert.equal(nextVersionNumber([1, 5]), 6)
})

test('nextVersionNumber ignores anything that is not a version', () => {
  assert.equal(nextVersionNumber([1, 2.5, Number.NaN, -3]), 2)
})

test('toolKey is the space and the name, which is what an install pins', () => {
  assert.equal(toolKey('community:acme', 'deal-pipeline'), 'community:acme/deal-pipeline')
})

// ── slugs ──

test('uniqueSlug leaves a free name alone', () => {
  assert.equal(uniqueSlug('board', new Set()), 'board')
  assert.equal(uniqueSlug('board', new Set(['deals'])), 'board')
})

test('uniqueSlug counts up past every taken slug', () => {
  assert.equal(uniqueSlug('board', new Set(['board'])), 'board-2')
  assert.equal(uniqueSlug('board', new Set(['board', 'board-2'])), 'board-3')
  assert.equal(uniqueSlug('board', new Set(['board', 'board-2', 'board-3'])), 'board-4')
})

test('uniqueSlug keeps the result a valid tool name at the length limit', () => {
  const long = 'a'.repeat(63)
  const slug = uniqueSlug(long, new Set([long]))
  assert.ok(slug.length <= 63)
  assert.ok(TOOL_NAME_RE.test(slug), slug)
  assert.equal(slug.endsWith('-2'), true)
})

// ── type claims ──

const CUSTOM = { customTypes: ['deal', 'invoice'], pageOwners: new Map<string, string>() }

test('a page claim on a member-invented type is granted', () => {
  const r = resolveTypeClaims([{ type: 'deal', mode: 'page' }], CUSTOM)
  assert.deepEqual(r.claims, { deal: 'page' })
  assert.deepEqual(r.downgraded, [])
  assert.deepEqual(r.conflicts, [])
})

test('a page claim on a built-in type is downgraded to a tab', () => {
  const r = resolveTypeClaims([{ type: 'person', mode: 'page' }], {
    customTypes: ['deal'],
    pageOwners: new Map(),
  })
  assert.deepEqual(r.claims, { person: 'tab' })
  assert.deepEqual(r.downgraded, ['person'])
  assert.deepEqual(r.conflicts, [])
})

test('a page claim on a type this space has never heard of is a tab too', () => {
  const r = resolveTypeClaims([{ type: 'widget', mode: 'page' }], CUSTOM)
  assert.deepEqual(r.claims, { widget: 'tab' })
  assert.deepEqual(r.downgraded, ['widget'])
})

test('a page already owned by another install is reported, never taken', () => {
  const r = resolveTypeClaims([{ type: 'deal', mode: 'page' }], {
    customTypes: ['deal'],
    pageOwners: new Map([['deal', 'deal-board']]),
  })
  assert.deepEqual(r.claims, {}, 'the claim is left out for the admin to decide')
  assert.deepEqual(r.conflicts, [{ type: 'deal', heldBy: 'deal-board' }])
  assert.deepEqual(r.downgraded, [])
})

test('a tab claim is always granted, owned page or not', () => {
  const r = resolveTypeClaims([{ type: 'deal', mode: 'tab' }], {
    customTypes: ['deal'],
    pageOwners: new Map([['deal', 'deal-board']]),
  })
  assert.deepEqual(r.claims, { deal: 'tab' })
  assert.deepEqual(r.conflicts, [])
})

test('claims resolve independently and keep the first reading of a repeat', () => {
  const r = resolveTypeClaims(
    [
      { type: 'deal', mode: 'page' },
      { type: 'person', mode: 'page' },
      { type: 'invoice', mode: 'tab' },
      { type: 'deal', mode: 'tab' },
    ],
    CUSTOM,
  )
  assert.deepEqual(r.claims, { deal: 'page', person: 'tab', invoice: 'tab' })
  assert.deepEqual(r.downgraded, ['person'])
})

test('type names are normalised, so casing in a snapshot cannot fork a claim', () => {
  const r = resolveTypeClaims([{ type: 'Deal', mode: 'page' } as ToolTypeSurface], {
    customTypes: ['DEAL'],
    pageOwners: new Map(),
  })
  assert.deepEqual(r.claims, { deal: 'page' })
})

test('a tool that claims no types claims nothing', () => {
  const r = resolveTypeClaims([], CUSTOM)
  assert.deepEqual(r, { claims: {}, downgraded: [], conflicts: [] })
})

// ── decoding the snapshot columns ──

const NOTE = `---
type: tool
title: Deal Pipeline
description: Kanban over deal notes
version: 3
surfaces:
  rail: { label: Deals, icon: kanban }
  types: [{ type: deal, mode: page }]
perimeter:
  read: ["deals/**"]
  write: ["deals/**"]
  types: [deal]
  connectors: [hubspot]
  agents: ["deal-*"]
---

Docs.
`

test('a published config round-trips through the JSON column', () => {
  const parsed = parseToolConfig(parseFrontmatter(NOTE), 'deal-pipeline')
  assert.ok(parsed.ok)
  const stored = JSON.parse(JSON.stringify(parsed.config)) as unknown
  assert.deepEqual(decodeToolConfig(stored, 'deal-pipeline'), parsed.config)
  assert.deepEqual(decodeToolPerimeter(stored && (stored as { perimeter: unknown }).perimeter), parsed.config.perimeter)
})

test('a half-written perimeter column decodes to "declares nothing", never undefined', () => {
  assert.deepEqual(decodeToolPerimeter({ read: ['deals/**'] }), {
    ...EMPTY_PERIMETER,
    read: ['deals/**'],
  })
  for (const junk of [null, undefined, 'nope', 7, []]) {
    assert.deepEqual(decodeToolPerimeter(junk), EMPTY_PERIMETER, String(junk))
  }
  assert.deepEqual(decodeToolPerimeter({ read: ['ok', 5, '', null] }).read, ['ok'])
})

test('a config column missing its surfaces still names the tool', () => {
  const config = decodeToolConfig({ title: 'Board' }, 'board')
  assert.equal(config.name, 'board')
  assert.equal(config.title, 'Board')
  assert.equal(config.version, 0)
  assert.deepEqual(config.surfaces, { rail: null, types: [] })
  assert.deepEqual(config.perimeter, EMPTY_PERIMETER)
})

test('a rail with half a declaration is no rail — the sidebar needs both halves', () => {
  assert.equal(decodeToolConfig({ surfaces: { rail: { label: 'Deals' } } }, 'x').surfaces.rail, null)
  assert.deepEqual(decodeToolConfig({ surfaces: { rail: { label: 'Deals', icon: 'kanban' } } }, 'x').surfaces.rail, {
    label: 'Deals',
    icon: 'kanban',
  })
})

test('a type surface with no type is dropped, and an unknown mode reads as a tab', () => {
  const surfaces = decodeToolConfig(
    { surfaces: { types: [{ mode: 'page' }, { type: 'deal', mode: 'nonsense' }, 'deal'] } },
    'x',
  ).surfaces.types
  assert.deepEqual(surfaces, [{ type: 'deal', mode: 'tab' }])
})

// ── the surface routes and UI are written against ──

test('the registry library exposes the marketplace lifecycle', () => {
  for (const fn of [
    publishTool,
    withdrawVersion,
    listReviewQueue,
    reviewVersion,
    browseVersions,
    getVersion,
    versionHistory,
    previousApprovedVersion,
    perimeterDiffForVersion,
  ]) {
    assert.equal(typeof fn, 'function')
  }
})

test('the install library exposes the space-side lifecycle', () => {
  for (const fn of [
    listInstalls,
    installVersion,
    uninstall,
    setInstallEnabled,
    setTypeClaims,
    applyUpgrade,
    refreshRequirements,
  ]) {
    assert.equal(typeof fn, 'function')
  }
})

test('the published shapes are what the routes and the space DTO carry', () => {
  const status: ToolVersionStatus = 'approved'
  const summary: ToolVersionSummary = {
    id: 'v1',
    key: 'community:acme/deal-pipeline',
    name: 'deal-pipeline',
    version: 3,
    title: 'Deal Pipeline',
    description: 'Kanban over deal notes',
    status,
    submittedAt: '2026-08-18T00:00:00.000Z',
    reviewedAt: null,
    reviewNote: null,
    sizeBytes: 2048,
    sourceSpaceId: 'community:acme',
    author: { userId: 'u1', name: 'Ana' },
    perimeter: EMPTY_PERIMETER,
    surfaces: { rail: { label: 'Deals', icon: 'kanban' }, types: [] },
  }
  const detail: ToolVersionDetail = { ...summary, config: decodeToolConfig({}, 'deal-pipeline'), indexSource: '', uiSource: '', dataSource: '' }
  const entry: BrowseEntry = { ...summary, installs: 2 }
  const page: BrowsePage = { items: [entry], nextCursor: null }
  const refusal: RegistryError = { ok: false, status: 403, error: 'nope' }
  const published: PublishResult = { ok: true, version: summary, warning: null }
  const reviewed: ReviewResult = { ok: true, version: summary, upgraded: 1 }
  const withdrawn: VersionResult = { ok: true, version: summary }

  assert.equal(detail.config.name, 'deal-pipeline')
  assert.equal(page.items[0].installs, 2)
  assert.equal(refusal.ok, false)
  assert.equal(published.ok && published.warning, null)
  assert.equal(reviewed.ok && reviewed.upgraded, 1)
  assert.equal(withdrawn.ok && withdrawn.version.version, 3)
})

test('the install shapes carry what the rail, the page and the banner need', () => {
  const mode: TypeClaimMode = 'page'
  const claims: TypeClaims = { deal: mode }
  const conflict: TypeClaimConflict = { type: 'deal', heldBy: 'deal-board' }
  const resolution: TypeClaimResolution = { claims, downgraded: [], conflicts: [conflict] }
  const install: InstallSummary = {
    id: 'i1',
    key: 'community:acme/deal-pipeline',
    slug: 'deal-pipeline',
    title: 'Deal Pipeline',
    description: null,
    version: 3,
    enabled: true,
    requirements: { connectors: ['hubspot'], types: [], agents: [] },
    degraded: true,
    typeClaims: claims,
    rail: { label: 'Deals', icon: 'kanban' },
    types: [{ type: 'deal', mode: 'page' }],
    pendingVersion: null,
  }
  const dto: InstalledToolDto = {
    id: install.id,
    key: install.key,
    slug: install.slug,
    title: install.title,
    icon: 'kanban',
    label: 'Deals',
    href: '/t/deal-pipeline',
    enabled: true,
    degraded: true,
    types: claims,
  }
  const installed: InstallResult = { ok: true, install, downgraded: [], conflicts: [conflict] }
  const updated: InstallUpdateResult = { ok: true, install }
  const removed: UninstallResult = { ok: true }
  const refreshed: RefreshResult = { ok: true, installs: [install] }

  assert.equal(dto.href, `/t/${install.slug}`)
  assert.equal(resolution.conflicts[0].heldBy, 'deal-board')
  assert.equal(installed.ok && installed.install.degraded, true)
  assert.equal(updated.ok && updated.install.slug, 'deal-pipeline')
  assert.equal(removed.ok, true)
  assert.equal(refreshed.ok && refreshed.installs.length, 1)
})
