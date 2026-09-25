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
  installability,
  listReviewQueue,
  listSpaceApprovalQueue,
  nextVersionNumber,
  pageByCursor,
  perimeterDiffForVersion,
  publishTool,
  reviewSpaceVersion,
  reviewVersion,
  submitToMarketplace,
  toolKey,
  versionHistory,
  previousApprovedVersion,
  perimeterDiffIsEmpty,
  shouldAutoApprove,
  surfacesUnchanged,
  trustedPublishers,
  AUTO_APPROVE_NOTE,
  AUTO_REVIEWER,
  withdrawFromMarketplace,
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
import { parseToolConfig, TOOL_NAME_RE, type ToolConfig, type ToolTypeSurface } from '@/lib/tools/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { EMPTY_PERIMETER, diffPerimeter } from '@/lib/tools/perimeter'

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
  assert.equal(toolKey('space:acme', 'deal-pipeline'), 'space:acme/deal-pipeline')
})

// ── who may install what (the two verdicts) ──

const OWN = 'space:acme'
const STRANGER = 'space:other'

test('a version its own space approved installs in that space', () => {
  assert.deepEqual(
    installability({
      status: 'approved',
      marketplaceStatus: null,
      sourceSpaceId: OWN,
      spaceId: OWN,
    }),
    { ok: true },
  )
})

test('an unlisted version is refused everywhere else — the private-space rule', () => {
  const verdict = installability({
    status: 'approved',
    marketplaceStatus: null,
    sourceSpaceId: OWN,
    spaceId: STRANGER,
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.ok === false ? verdict.error : '', /private to the space that wrote it/)
})

test('a LISTED version installs anywhere — that is what listing means', () => {
  assert.equal(
    installability({
      status: 'approved',
      marketplaceStatus: 'approved',
      sourceSpaceId: OWN,
      spaceId: STRANGER,
    }).ok,
    true,
  )
})

test('a listing cannot rescue a version its own space never approved', () => {
  // The order matters: the space's verdict is asked first, so a rejected or
  // still-queued version is refused even in the space that wrote it.
  for (const status of ['pending', 'rejected', 'withdrawn'] as const) {
    const verdict = installability({
      status,
      marketplaceStatus: 'approved',
      sourceSpaceId: OWN,
      spaceId: OWN,
    })
    assert.equal(verdict.ok, false, status)
  }
})

test('a version waiting on an admin says so, rather than “not approved”', () => {
  const verdict = installability({
    status: 'pending',
    marketplaceStatus: null,
    sourceSpaceId: OWN,
    spaceId: OWN,
  })
  assert.match(verdict.ok === false ? verdict.error : '', /waiting on an admin/)
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
  assert.deepEqual(config.surfaces, { rail: null, types: [], nav: null, actions: [] })
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

// ── browse paging ──

test('paging walks the listing and stops', () => {
  const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }]
  const first = pageByCursor(rows, null, 2)
  assert.deepEqual(
    first.page.map((r) => r.key),
    ['a', 'b'],
  )
  assert.equal(first.nextCursor, 'b')

  const second = pageByCursor(rows, first.nextCursor, 2)
  assert.deepEqual(
    second.page.map((r) => r.key),
    ['c', 'd'],
  )
  assert.equal(second.nextCursor, 'd')

  const last = pageByCursor(rows, second.nextCursor, 2)
  assert.deepEqual(
    last.page.map((r) => r.key),
    ['e'],
  )
  assert.equal(last.nextCursor, null, 'the final page must not hand back another cursor')
})

test('a cursor that has left the listing ends the page instead of restarting it', () => {
  // The version was withdrawn / rejected / renamed between two requests. The
  // regression this pins: returning page one WITH a cursor, which loops forever.
  const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
  const stale = pageByCursor(rows, 'gone', 2)
  assert.deepEqual(stale.page, [])
  assert.equal(stale.nextCursor, null)
})

test('the page size is clamped and no cursor starts at the top', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ key: `k${i}` }))
  assert.equal(pageByCursor(rows, null, 0).page.length, 1)
  assert.equal(pageByCursor(rows, null, 1000).page.length, 100)
  assert.equal(pageByCursor(rows, null, undefined).page[0]?.key, 'k0')
})

// ── the surface routes and UI are written against ──

test('the registry library exposes the marketplace lifecycle', () => {
  for (const fn of [
    publishTool,
    withdrawVersion,
    listSpaceApprovalQueue,
    reviewSpaceVersion,
    submitToMarketplace,
    withdrawFromMarketplace,
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
    key: 'space:acme/deal-pipeline',
    name: 'deal-pipeline',
    version: 3,
    title: 'Deal Pipeline',
    description: 'Kanban over deal notes',
    status,
    submittedAt: '2026-08-18T00:00:00.000Z',
    reviewedAt: null,
    reviewNote: null,
    marketplaceStatus: null,
    marketplaceSubmittedAt: null,
    marketplaceReviewedAt: null,
    marketplaceReviewNote: null,
    sizeBytes: 2048,
    sourceSpaceId: 'space:acme',
    author: { userId: 'u1', name: 'Ana' },
    perimeter: EMPTY_PERIMETER,
    surfaces: { rail: { label: 'Deals', icon: 'kanban' }, types: [] },
    iconSvg: null,
    releaseNotes: 'Adds the archive column',
    tags: ['crm', 'kanban'],
    previewUrl: null,
    revokedAt: null,
    revokeReason: null,
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
    key: 'space:acme/deal-pipeline',
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
    iconSvg: null,
    label: 'Deals',
    href: '/t/deal-pipeline',
    enabled: true,
    degraded: true,
    types: claims,
    name: 'deal-pipeline',
    version: 3,
    nav: { style: 'tabs', sections: [{ id: 'board', label: 'Board' }] },
    actions: [{ id: 'new-deal', label: 'New deal' }],
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

// ── trusted publishers (ticket 4.2) ─────────────────────────────────────────

test('trustedPublishers reads a comma-separated list, trimmed, and unset means nobody', () => {
  assert.deepEqual([...trustedPublishers(undefined)], [])
  assert.deepEqual([...trustedPublishers('')], [])
  assert.deepEqual([...trustedPublishers(' space_a, space_b ,,')], ['space_a', 'space_b'])
})

test('perimeterDiffIsEmpty is true only when nothing was added or removed anywhere', () => {
  const same = { ...EMPTY_PERIMETER, read: ['deals/**'], connectors: ['hubspot'] }
  assert.equal(perimeterDiffIsEmpty(diffPerimeter(same, same)), true)
  assert.equal(perimeterDiffIsEmpty(diffPerimeter(same, { ...same, write: ['deals/**'] })), false)
  assert.equal(perimeterDiffIsEmpty(diffPerimeter(same, { ...same, connectors: [] })), false)
})

test('shouldAutoApprove needs a trusted space AND a previous approved version AND an empty diff', () => {
  const trusted = new Set(['space_trusted'])
  const perimeter = { ...EMPTY_PERIMETER, read: ['deals/**'] }
  const unchanged = diffPerimeter(perimeter, perimeter)
  const widened = diffPerimeter(perimeter, { ...perimeter, write: ['deals/**'] })
  const surfaces = { rail: { label: 'Deals', icon: 'briefcase' }, types: [{ type: 'deal', mode: 'page' as const }] }
  const previous = { id: 'v1', version: 1, surfaces }

  assert.equal(shouldAutoApprove({ trustedPublishers: trusted, sourceSpaceId: 'space_trusted', previous, diff: unchanged, surfaces }), true)
  // A stranger's code is always read by a person.
  assert.equal(shouldAutoApprove({ trustedPublishers: trusted, sourceSpaceId: 'space_other', previous, diff: unchanged, surfaces }), false)
  // The first version of anything is read by a person — there is nothing to diff against.
  assert.equal(shouldAutoApprove({ trustedPublishers: trusted, sourceSpaceId: 'space_trusted', previous: null, diff: unchanged, surfaces }), false)
  // Any change in reach goes to the queue, trusted or not.
  assert.equal(shouldAutoApprove({ trustedPublishers: trusted, sourceSpaceId: 'space_trusted', previous, diff: widened, surfaces }), false)
  // Nobody trusted, nothing skips.
  assert.equal(shouldAutoApprove({ trustedPublishers: new Set(), sourceSpaceId: 'space_trusted', previous, diff: unchanged, surfaces }), false)
})

test('shouldAutoApprove also needs the surfaces unchanged — a new rail entry or type claim is reviewed by a person', () => {
  const trusted = new Set(['space_trusted'])
  const perimeter = { ...EMPTY_PERIMETER, read: ['deals/**'] }
  const unchanged = diffPerimeter(perimeter, perimeter)
  const surfaces: ToolConfig['surfaces'] = { rail: { label: 'Deals', icon: 'briefcase' }, types: [{ type: 'deal', mode: 'page' }, { type: 'org', mode: 'tab' }] }
  const previous = { id: 'v1', version: 1, surfaces }
  const go = (next: typeof surfaces) =>
    shouldAutoApprove({ trustedPublishers: trusted, sourceSpaceId: 'space_trusted', previous, diff: unchanged, surfaces: next })

  // Same claims, different order: not a change.
  assert.equal(go({ ...surfaces, types: [surfaces.types[1], surfaces.types[0]] }), true)
  // Rail dropped, relabelled or re-iconed; a claim added, removed, or its mode changed: all reviewed.
  assert.equal(go({ ...surfaces, rail: null }), false)
  assert.equal(go({ ...surfaces, rail: { label: 'Pipeline', icon: 'briefcase' } }), false)
  assert.equal(go({ ...surfaces, rail: { label: 'Deals', icon: 'star' } }), false)
  assert.equal(go({ ...surfaces, types: [...surfaces.types, { type: 'person', mode: 'tab' as const }] }), false)
  assert.equal(go({ ...surfaces, types: [surfaces.types[0]] }), false)
  assert.equal(go({ ...surfaces, types: [{ type: 'deal', mode: 'tab' as const }, surfaces.types[1]] }), false)
  // The pure comparison behind it.
  assert.equal(surfacesUnchanged({ rail: null, types: [] }, { rail: null, types: [] }), true)
  assert.equal(surfacesUnchanged({ rail: null, types: [] }, { rail: { label: 'X', icon: 'star' }, types: [] }), false)
})

test('the auto-review markers are what the audit line and the panel read', () => {
  assert.equal(AUTO_REVIEWER, 'auto')
  assert.match(AUTO_APPROVE_NOTE, /trusted publisher/)
  assert.match(AUTO_APPROVE_NOTE, /unchanged perimeter and surfaces/)
})
