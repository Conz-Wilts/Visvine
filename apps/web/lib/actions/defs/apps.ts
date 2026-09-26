/**
 * The authoring loop over MCP: the tools that let an external coding agent
 * (Claude Code, Cursor) build a Visvine Tool without a checkout of this repo.
 *
 *   learn    get_tool_sdk               the guide, the .d.ts and the bridge surface
 *   author   create_tool, write_tool    scaffold, then edit one file at a time
 *   verify   check_tool, read_tool      compile + lint, read back what is stored
 *   see it   preview_tool, list_tools   where it renders, what exists here
 *   ship     publish_tool, install_tool the review gate and the marketplace
 *   files    push_tool, check_package   a folder of work, as a .vvtool package
 *
 * The loop this surface is designed for — and the reason every write answers
 * with a fresh build rather than an "ok" — is:
 *
 *   get_tool_sdk → create_tool → write_tool(ui.tsx) → read the diagnostics →
 *   write_tool again → check_tool → preview_tool → publish_tool
 *
 * A Tool is three notes (`tools/<name>/index.md`, `ui.tsx`, `data.js`), so every
 * write here goes through lib/tools/service.ts and therefore through
 * `writeGated` — the same grants, restricted folders and write denials as any
 * other note. Nothing in this file re-implements authorization: `resolveTarget`
 * resolves the principal exactly as the other MCP tools do, publish and install
 * are refused by the registry's own admin checks, and the refusals come back
 * with their status attached.
 *
 * Every service call sits behind {@link AppToolDeps} so the handlers can be
 * exercised — the write → diagnostics round trip, an admin refusal — with no
 * database. `registerAppTools` is the only thing that reaches for the live
 * implementations.
 */
import { inSpace } from '@/lib/spaces/shared/spaceUrl'
import { z } from 'zod'
import { defineAction, ActionError, type ActionCaller } from '@/lib/actions/types'
import { intakeSummary } from '@/lib/actions/shared/intake'
import { resolveTarget, type Target } from '@/lib/actions/resolve'
import { featureAccessForbidden } from '@/lib/auth'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { toBuildSummary, rebuildTool, toolDiagnosticLine, type BuildSummary } from '@/lib/tools/builds'
import { manifestOf, TOOL_MODULE_RE, type ToolConfig } from '@/lib/tools/config'
import { checkPackage, pushPackage } from '@/lib/tools/package'
import { PACKAGE_LIMITS } from '@/lib/tools/package/shared/layout'
import { appOrigin as liveAppOrigin } from '@/lib/tools/origin'
import { describePerimeter } from '@/lib/tools/perimeter'
import { runStaticChecks, type StaticCheckInput } from '@/lib/tools/checks/analyze'
import {
  blockingFindings,
  findingLine,
  reportStatus,
  sortFindings,
  type CheckReport,
} from '@/lib/tools/checks/findings'
import { recordReport } from '@/lib/tools/checks/runs'
import { snapshotPreviewRows } from '@/lib/tools/collections'
import { snapshotPreviewToolState } from '@/lib/tools/state'
import { advisoriesFor } from '@/lib/tools/advisories'
import { BRIDGE_METHODS } from '@/lib/tools/protocol'
import { TOOL_PHONE_REFUSAL } from '@/lib/tools/clientClass'
import { describeRequirements, isDegraded, sourceRequirements } from '@/lib/tools/requirements'
import { TOOL_AUTHOR_GUIDE, TOOL_KIT_DTS } from '@/lib/tools/sdkDocs'
import { renderCatalog, TOOL_CATALOG } from '@/lib/tools/catalog'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { reviewModel, reviewScreens, visualReviewAvailable } from '@/lib/tools/visualReview'
import { passes } from '@/lib/tools/shared/visualRubric'
import { TOOL_FACT_KEYS } from '@/lib/tools/indexFacts'
import { applySpec, checkSpec, templateById, TOOL_TEMPLATES, type ToolTemplate } from '@/lib/tools/templates'
import { bindableSpace as bindableSpaceService } from '@/lib/tools/bindable'
import { bindingChoices, type BindableSpace, type BindingValues } from '@visvine/tool-protocol/bindings'
import {
  captureToolPreview,
  MAX_TOOL_STEPS,
  SCREENSHOT_BUDGET_MS,
  type ScreenshotRequest,
  type ScreenshotResult,
  type ToolStep,
} from '@/lib/tools/screenshot'
import {
  configureTool as configureToolService,
  createTool as createToolService,
  deleteTool as deleteToolService,
  describeAuthoredTool as describeAuthoredToolService,
  listAuthoredTools as listAuthoredToolsService,
  writeToolFile as writeToolFileService,
  type AuthoredToolDetail,
  type AuthoredToolSummary,
  type ConfigureToolResult,
  type CreateToolResult,
  type ToolFileName,
  type WriteToolFileResult,
} from '@/lib/tools/service'
import {
  publishTool as publishToolService,
  versionHistory as versionHistoryService,
  type PublishResult,
  type ToolVersionSummary,
} from '@/lib/tools/registry'
import {
  applyUpgrade as applyUpgradeService,
  installVersion as installVersionService,
  listInstalls as listInstallsService,
  setInstallBindings as setInstallBindingsService,
  setInstallEnabled as setInstallEnabledService,
  setTypeClaims as setTypeClaimsService,
  uninstall as uninstallService,
  spaceFacts as spaceFactsService,
  type InstallResult,
  type InstallSummary,
  type InstallUpdateResult,
  type SpaceFacts,
  type TypeClaimChoice,
  type UninstallResult,
} from '@/lib/tools/installs'

type Actor = { userId: string; email: string }

/** What is known against the curated dependencies a config declares. */
async function advisoriesOf(config: ToolConfig | null) {
  return config ? advisoriesFor(Object.keys(manifestOf(config).dependencies)) : []
}

/**
 * The filenames an author addresses, in the order they matter.
 *
 * `icon.svg` is last because it is optional and it is not code: a Tool only has
 * one if it ships its own rail glyph rather than picking a built-in shape
 * (lib/tools/config.ts#TOOL_CUSTOM_RAIL_ICON). It is writable over MCP like the
 * rest — an authoring agent that can build a Tool can draw its icon — and the
 * build sanitizes whatever comes through (lib/tools/iconSvg.ts) before anything
 * renders it.
 */
const TOOL_FILES = ['index.md', 'ui.tsx', 'data.js', 'icon.svg'] as const satisfies readonly ToolFileName[]

/**
 * What `create_tool` actually writes. Not the same list: a new Tool gets its
 * config and its two source scaffolds, and no icon — an icon is something an
 * author adds when they want one, and reporting a file that isn't there would
 * send an agent looking for it.
 */
const SCAFFOLDED_FILES: readonly ToolFileName[] = ['index.md', 'ui.tsx', 'data.js']

/**
 * Every service call the handlers make, in one seam. Faked wholesale in tests;
 * the live implementations below are the only place this file touches prisma,
 * the note store or the registry.
 */
export interface AppToolDeps {
  resolveTarget(ctx: ActionCaller, spaceId: string): Promise<Target>
  /**
   * Whether the caller is locked out of the `tools` feature key entirely —
   * checked right after every `resolveTarget`, before a handler reaches the
   * service, exactly like `requireToolsAccess` in lib/tools/route.ts and
   * `forbiddenForTools` in lib/tools/target.ts.
   */
  featureAccessForbidden(userId: string, spaceId: string, email: string): Promise<boolean>
  listAuthoredTools(p: ContextPrincipal, context: Context): Promise<AuthoredToolSummary[]>
  describeAuthoredTool(
    p: ContextPrincipal,
    context: Context,
    name: string,
  ): Promise<AuthoredToolDetail | null>
  deleteTool: typeof deleteToolService
  createTool(
    p: ContextPrincipal,
    context: Context,
    input: { name: string; title?: string; description?: string },
  ): Promise<CreateToolResult>
  writeToolFile(
    p: ContextPrincipal,
    context: Context,
    name: string,
    file: ToolFileName,
    content: string,
  ): Promise<WriteToolFileResult>
  /** A forced recompile, already decoded — check_tool's first act. */
  rebuild(spaceId: string, name: string): Promise<BuildSummary>
  publishTool(
    p: ContextPrincipal,
    context: Context,
    name: string,
    opts: { note?: string; releaseNotes?: string },
  ): Promise<PublishResult>
  installVersion(
    spaceId: string,
    versionId: string,
    actor: { userId: string; email: string },
    opts?: { placement?: 'rail' | 'more'; bindings?: BindingValues; settings?: Record<string, unknown> },
  ): Promise<InstallResult>
  listInstalls(spaceId: string): Promise<InstallSummary[]>
  /** Change a Tool's facts row (lib/tools/service.ts#configureTool). */
  configureTool(p: ContextPrincipal, context: Context, name: string, patch: Record<string, unknown>): Promise<ConfigureToolResult>
  /** The static stages over a working copy, recorded against it (lib/tools/checks/). */
  checkWorkingCopy(spaceId: string, name: string, sourceHash: string, input: StaticCheckInput): Promise<CheckReport>
  /** The four changes `update_install` makes, each admin-gated by the service. */
  setInstallEnabled(spaceId: string, installId: string, actor: Actor, enabled: boolean): Promise<InstallUpdateResult>
  setTypeClaims(spaceId: string, installId: string, actor: Actor, claims: Record<string, TypeClaimChoice>): Promise<InstallUpdateResult>
  applyUpgrade(spaceId: string, installId: string, actor: Actor): Promise<InstallUpdateResult>
  uninstall(spaceId: string, installId: string, actor: Actor): Promise<UninstallResult>
  /** An install's binding and setting values (lib/tools/installs.ts#setInstallBindings). */
  setInstallBindings(
    spaceId: string,
    installId: string,
    actor: Actor,
    patch: { bindings?: BindingValues; settings?: Record<string, unknown> },
  ): Promise<InstallUpdateResult>
  /** What a space can bind a slot to (lib/tools/bindable.ts). */
  bindableSpace(spaceId: string): Promise<BindableSpace>
  /** The newest APPROVED version of a marketplace key, for `install_tool { key }`. */
  latestApprovedVersion(key: string): Promise<ToolVersionSummary | null>
  /**
   * The three name spaces a perimeter is checked against, plus which of the
   * types a Tool may own the page for — lib/tools/installs.ts#spaceFacts, read
   * under the CALLER's own principal rather than an admin's: check_tool is a
   * lint for the author, and an author who cannot see a connector cannot write
   * a Tool against it either.
   */
  spaceFacts(p: ContextPrincipal, context: Context): Promise<SpaceFacts>
  appOrigin(): string
  /**
   * A headless render of the preview page as the caller (lib/tools/screenshot.ts).
   * Answers `{ available: false }` wherever it cannot run; the handlers then
   * fall back to links.
   */
  capturePreview(req: ScreenshotRequest): Promise<ScreenshotResult>
  /**
   * What a working copy's preview holds (collection rows and state), and a
   * way to put it back — try_tool's rehearsal. Absent, a try keeps its writes.
   */
  rehearse?(spaceId: string, name: string): Promise<() => Promise<{ added: number; changed: number; removed: number }>>
}

const liveDeps: AppToolDeps = {
  resolveTarget: (ctx, spaceId) => resolveTarget(ctx, spaceId),
  featureAccessForbidden: (userId, spaceId, email) =>
    featureAccessForbidden(userId, spaceId, 'directory', email),
  listAuthoredTools: listAuthoredToolsService,
  describeAuthoredTool: describeAuthoredToolService,
  createTool: createToolService,
  deleteTool: deleteToolService,
  writeToolFile: writeToolFileService,
  rebuild: async (spaceId, name) => toBuildSummary(await rebuildTool(spaceId, name)),
  publishTool: publishToolService,
  installVersion: installVersionService,
  listInstalls: listInstallsService,
  configureTool: configureToolService,
  checkWorkingCopy: async (spaceId, name, sourceHash, input) => {
    const report = await runStaticChecks({ ...input, advisories: await advisoriesOf(input.config) })
    await recordReport({ spaceId, name, versionId: null, sourceHash, trigger: 'check', report })
    return report
  },
  setInstallEnabled: setInstallEnabledService,
  setTypeClaims: setTypeClaimsService,
  applyUpgrade: applyUpgradeService,
  uninstall: uninstallService,
  setInstallBindings: setInstallBindingsService,
  bindableSpace: bindableSpaceService,
  latestApprovedVersion: async (key) => {
    // versionHistory is newest-first, so the first listed row is the newest.
    // LISTED, not merely approved: `install_tool { key }` names a tool by its
    // marketplace identity, and a version its own space approved but never
    // offered to anyone is not something a key lookup may hand out. Installing
    // a space's own unlisted version is done by id, where the install gate
    // re-asks the same question for the installing space. A withdrawn version
    // is never handed out.
    const history = await versionHistoryService(key)
    return history.find((v) => v.status === 'approved' && v.marketplaceStatus === 'approved' && !v.revokedAt) ?? null
  },
  spaceFacts: spaceFactsService,
  appOrigin: liveAppOrigin,
  capturePreview: captureToolPreview,
  rehearse: async (spaceId, name) => {
    const rows = await snapshotPreviewRows(spaceId, name)
    const state = snapshotPreviewToolState(spaceId, name)
    return async () => {
      state()
      return rows()
    }
  },
}

// ── shared shapes ─────────────────────────────────────────────────────────────

/**
 * A build as an authoring agent reads it. `errors` are plain lines
 * (`ui.tsx:12:5 Expected ">"`) because that is what an agent can act on without
 * unpacking a structure, and `config_error` is kept separate from them: a broken
 * `index.md` is a different fix from a syntax error in the code.
 */
function buildReport(build: BuildSummary | null) {
  if (!build) {
    return {
      ok: false,
      never_compiled: true,
      errors: ['This tool has never been compiled — write ui.tsx to build it.'],
      warnings: [],
      config_error: null,
      size_bytes: 0,
    }
  }
  return {
    ok: build.ok,
    errors: build.errors.map(toolDiagnosticLine),
    warnings: build.warnings.map(toolDiagnosticLine),
    config_error: build.configError,
    size_bytes: build.sizeBytes,
    built_at: build.updatedAt,
  }
}

/**
 * A check report as an authoring agent reads it: what blocks a publish, what an
 * admin will be asked about, what is only said, and the risk score — lines,
 * worst first, each naming its file and line.
 */
function checksView(report: CheckReport) {
  const all = sortFindings([...report.compatibility.findings, ...report.security.findings])
  const risk = report.security.risk
  return {
    status: reportStatus(report),
    compatibility: report.compatibility.status,
    security: report.security.status,
    blocking: blockingFindings(report).map(findingLine),
    flags: all.filter((f) => f.severity === 'medium' || f.severity === 'low').map((f) => `${f.severity}: ${findingLine(f)}`),
    notes: all.filter((f) => f.severity === 'info').map(findingLine),
    risk: risk ? { score: risk.score, level: risk.level, factors: risk.factors } : null,
  }
}

/**
 * Where the author can look at what they just wrote. Both forms every time: the
 * desktop app opens the deep link in place, and anything else (a browser, a
 * terminal that only prints links) needs the URL.
 */
function previewLinks(name: string, origin: string, spaceId: string) {
  const path = inSpace(spaceId, `/tools/preview/${name}`)
  return {
    desktop_deep_link: `visvine-desktop://open${path}`,
    preview_url: `${origin}${path}`,
  }
}

/** What a Tool asks to occupy in the app, as lines rather than a config dump. */
function describeSurfaces(config: ToolConfig | null): string[] {
  if (!config) return []
  const lines: string[] = []
  if (config.surfaces.rail) {
    lines.push(
      `Sidebar row "${config.surfaces.rail.label}" (${config.surfaces.rail.icon}) with its own full-pane page`,
    )
  } else {
    lines.push('No sidebar row — this tool has no page of its own')
  }
  for (const claim of config.surfaces.types) {
    lines.push(
      claim.mode === 'page'
        ? `Owns the page for node type "${claim.type}"`
        : `Adds a tab to the page for node type "${claim.type}"`,
    )
  }
  return lines
}

/** Turn a service refusal (`{ ok: false, status, error }`) into a tool error. */
function refuse(result: { status: number; error: string }): never {
  throw new ActionError(result.status, result.error)
}

/**
 * The same gate every other Tools door enforces — REST routes
 * (`requireToolsAccess`) and the bridge (`forbiddenForTools`) both refuse a
 * space that switched the `tools` feature off before touching the service;
 * MCP authoring must too, or it becomes the one door left standing.
 */
async function requireToolsFeature(ctx: ActionCaller, target: Target, deps: AppToolDeps): Promise<void> {
  if (await deps.featureAccessForbidden(ctx.userId, target.context.spaceId, ctx.email)) {
    throw new ActionError(403, 'The Tools feature is not available to you in this space')
  }
}

/** The target plus the tool it names, or a 404 that says how to find one. */
async function requireTool(
  ctx: ActionCaller,
  spaceId: string,
  name: string,
  deps: AppToolDeps,
): Promise<{ target: Target; detail: AuthoredToolDetail }> {
  const target = await deps.resolveTarget(ctx, spaceId)
  await requireToolsFeature(ctx, target, deps)
  const detail = await deps.describeAuthoredTool(target.principal, target.context, name)
  if (!detail) {
    throw new ActionError(404, `No tool named "${name}" here — list_tools shows what exists.`)
  }
  return { target, detail }
}

// ── arguments ─────────────────────────────────────────────────────────────────

interface CreateToolArgs {
  space_id: string
  name: string
  title: string
  description: string
  plan?: string
  template?: string
  spec?: Record<string, unknown>
}

/**
 * The index note with the agreed plan written in as its `## Design` section —
 * above the scaffold's docs, so whoever edits the Tool next (any model, any
 * person) starts from what was decided rather than re-deciding it.
 */
export function withDesignSection(index: string, plan: string): string {
  const body = plan.trim().replace(/^#{1,6}\s*design\s*\n+/i, '')
  const section = `## Design\n\n${body}\n\n`
  const cut = [index.indexOf('\n## How it works'), index.indexOf('\n<!-- index:children -->')].find((i) => i >= 0)
  return cut === undefined ? `${index.trimEnd()}\n\n${section}` : `${index.slice(0, cut + 1)}${section}${index.slice(cut + 1)}`
}
interface ListToolsArgs {
  space_id: string
}
interface ReadToolArgs {
  space_id: string
  name: string
  file?: ToolFileName
}
interface WriteToolArgs {
  space_id: string
  name: string
  file: ToolFileName
  content: string
}
interface CheckToolArgs {
  space_id: string
  name: string
  /** Also render the preview headlessly and include its console errors (no image). */
  render?: boolean
  /** Also screenshot every section and band action and have them scored by eye. */
  review?: boolean
  /** What the person asked for — the review judges fit as well as looks. */
  request?: string
}
interface PreviewToolArgs {
  space_id: string
  name: string
  /** Render the preview headlessly and return the image + console errors. */
  screenshot?: boolean
  section?: string
  action?: string
  full_page?: boolean
  outline?: boolean
}
interface TryToolArgs {
  space_id: string
  name: string
  steps: ToolStep[]
  section?: string
  full_page?: boolean
}
interface PublishToolArgs {
  space_id: string
  name: string
  note?: string
  release_notes?: string
}
interface InstallToolArgs {
  space_id: string
  version_id?: string
  key?: string
  placement?: 'rail' | 'more'
  bindings?: Record<string, string>
  settings?: Record<string, unknown>
}

/** A template and its spec, checked: the template to copy, or a 400 naming what is wrong with the spec. */
function startingTool(id: string, spec: Record<string, unknown> | undefined): { template: ToolTemplate; spec: Record<string, unknown> } {
  const template = templateById(id)
  if (!template) throw new ActionError(400, `No template "${id}" — pick one of ${TOOL_TEMPLATES.map((t) => t.id).join(', ')}.`)
  if (!spec) throw new ActionError(400, `A template needs a spec. ${template.id}'s:\n${template.specGuide}`)
  const checked = checkSpec(template, spec)
  if (!checked.ok) throw new ActionError(400, `The spec for ${template.id} needs fixing:\n- ${checked.problems.join('\n- ')}\n\nHow to write it:\n${template.specGuide}`)
  return { template, spec: checked.spec }
}

// ── handlers ──────────────────────────────────────────────────────────────────

async function createTool(ctx: ActionCaller, args: CreateToolArgs, deps: AppToolDeps = liveDeps) {
  // A template is checked before anything is written, so a bad spec costs a
  // refusal with its reasons and never a half-made Tool.
  const started = args.template ? startingTool(args.template, args.spec) : null
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const result = await deps.createTool(target.principal, target.context, {
    name: args.name,
    title: args.title,
    description: args.description,
  })
  if (!result.ok) refuse(result)
  try {
    let build = result.build
    if (args.plan?.trim()) {
      const detail = await deps.describeAuthoredTool(target.principal, target.context, result.name)
      const index = detail?.sources['index.md']
      if (!index) throw new ActionError(500, 'The created Tool has no index for its plan.')
      const written = await deps.writeToolFile(target.principal, target.context, result.name, 'index.md', withDesignSection(index, args.plan))
      if (!written.ok) refuse(written)
      build = written.build
    }
    if (started) {
      const facts = started.template.facts(started.spec)
      const configured = await deps.configureTool(target.principal, target.context, result.name, {
        sdk: '^2.0.0',
        surfaces: { rail: { label: args.title, icon: started.template.railIcon }, types: [], nav: facts.surfaces.nav, actions: facts.surfaces.actions },
        collections: facts.collections,
      })
      if (!configured.ok) refuse(configured)
      const written = await deps.writeToolFile(target.principal, target.context, result.name, 'ui.tsx', applySpec(started.template.id, started.spec))
      if (!written.ok) refuse(written)
      build = written.build
      if (!build.ok) throw new ActionError(400, `The template did not compile: ${build.errors.map((e) => e.message).join('; ') || build.configError}`)
      return {
        name: result.name,
        template: started.template.id,
        files: SCAFFOLDED_FILES.map((file) => `tools/${result.name}/${file}`),
        build: buildReport(build),
        ...previewLinks(result.name, deps.appOrigin(), target.context.spaceId),
        sections: facts.surfaces.nav?.sections.map((s) => s.id) ?? [],
        band_actions: facts.surfaces.actions.map((a) => a.id),
        next: [
          `It is built from the ${started.template.title} template with your spec, and opens with the spec's sample rows. Before hand-over, inspect every section and band action with preview_tool { screenshot: true }, fix the concrete problems you see with write_tool, and capture again. Exercise the main action with try_tool — a try is a rehearsal, so whatever it saves is put back and there is nothing to clean up. Keep the sample rows: they are the first look, and SampleData offers the person Clear. check_tool { review: true } adds a scored review when a judge is available; aim for 9/10 and report any unverified behaviour.`,
          'To change what it is about, edit the SPEC block in ui.tsx with read_tool and write_tool. To change how it looks or add behaviour, read_tool then write_tool ui.tsx — the SPEC block at the top holds the fields, and the kit\'s blocks (RecordBoard, RecordTable, RecordDialog, StatRow, Toolbar) draw everything else.',
        ],
      }
    }
    return {
      name: result.name,
      files: SCAFFOLDED_FILES.map((file) => `tools/${result.name}/${file}`),
      build: buildReport(build),
      ...previewLinks(result.name, deps.appOrigin(), target.context.spaceId),
      next: [
        'Call get_tool_sdk for its short index, then request the sections you need with get_tool_sdk { section }.',
        'configure_tool: surfaces (nav sections, band actions), collections, bindings and permissions — everything the plan decided. The bridge refuses anything undeclared.',
        'set_tool_icon: a built-in name or your own 24×24 stroke SVG.',
        `write_tool { name: "${result.name}", file: "ui.tsx", content } and read the build it hands back — kit components and Tailwind layout classes, never a painted page background.`,
        'Then the review loop: check_tool { render: true }, preview_tool { screenshot: true } per section and per band action, then try_tool through the main act.',
      ],
    }
  } catch (err) {
    // Only this call's successful scaffold is eligible for compensation. A
    // create conflict returns above and must never remove an existing Tool.
    const removed = await deps.deleteTool(target.principal, target.resolved, result.name)
    if (!removed.ok) throw new ActionError(removed.status, `Creation failed (${err instanceof Error ? err.message : String(err)}); cleanup failed: ${removed.error}`)
    throw err
  }
}

async function listTools(ctx: ActionCaller, args: ListToolsArgs, deps: AppToolDeps = liveDeps) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const [authored, installed] = await Promise.all([
    deps.listAuthoredTools(target.principal, target.context),
    deps.listInstalls(target.context.spaceId),
  ])
  return {
    authored: authored.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      path: tool.path,
      node_id: tool.nodeId,
      // 0 means never published; the registry number is the published one.
      published_version: tool.version,
      invalid: tool.invalid,
      build: buildReport(tool.build),
    })),
    installed: installed.map((install) => ({
      slug: install.slug,
      key: install.key,
      title: install.title,
      version: install.version,
      enabled: install.enabled,
      degraded: install.degraded,
      missing: describeRequirements(install.requirements),
      upgrade_available: install.pendingVersion?.version ?? null,
    })),
  }
}

async function readTool(ctx: ActionCaller, args: ReadToolArgs, deps: AppToolDeps = liveDeps) {
  const { detail } = await requireTool(ctx, args.space_id, args.name, deps)
  const every: Record<string, string | null> = { ...detail.sources, ...detail.modules }
  const wanted = args.file ? { [args.file]: every[args.file] ?? null } : every
  return {
    name: detail.name,
    title: detail.title,
    description: detail.description,
    path: detail.path,
    // The sources exactly as the compiler reads them: `ui.tsx` and `data.js`
    // are unwrapped out of the fenced blocks the notes store them in, so what
    // comes back here is what write_tool takes.
    files: wanted,
    config: detail.config,
    invalid: detail.invalid,
    build: buildReport(detail.build),
  }
}

async function writeTool(ctx: ActionCaller, args: WriteToolArgs, deps: AppToolDeps = liveDeps) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const result = await deps.writeToolFile(
    target.principal,
    target.context,
    args.name,
    args.file,
    args.content,
  )
  if (!result.ok) refuse(result)
  const report = buildReport(result.build)
  return {
    status: 'applied',
    path: result.path,
    file: args.file,
    // On every write, not only on create: the person you are working for asked
    // for something they can LOOK at, and a link they already have is one they
    // do not have to ask for again.
    ...previewLinks(args.name, deps.appOrigin(), target.context.spaceId),
    // The point of this tool: the write and its compile result are one answer,
    // so an author iterates on diagnostics without a second call.
    build: report,
    ...(report.ok
      ? {}
      : {
          fix: 'The tool will not run until this compiles. Each error is `file:line:column message`; read_tool returns the current source.',
        }),
  }
}

async function checkTool(ctx: ActionCaller, args: CheckToolArgs, deps: AppToolDeps = liveDeps) {
  const { target, detail } = await requireTool(ctx, args.space_id, args.name, deps)
  const build = await deps.rebuild(target.context.spaceId, args.name)
  const config = build.config ?? detail.config

  const facts = await deps.spaceFacts(target.principal, target.context)
  const requirements = config ? sourceRequirements(config, facts.available) : { connectors: [], types: [], agents: [] }

  // The same static stages a publish runs — so what check_tool says passes is
  // what publish will accept — recorded, so the Tool tab shows the same report.
  const report = await deps.checkWorkingCopy(target.context.spaceId, args.name, build.sourceHash, {
    index: detail.sources['index.md'],
    ui: detail.sources['ui.tsx'],
    data: detail.sources['data.js'],
    modules: detail.modules,
    config,
    build: { ok: build.ok, errors: build.errors, warnings: build.warnings, configError: build.configError },
    facts: { customTypes: facts.customTypes, missing: describeRequirements(requirements) },
  })
  const checks = checksView(report)
  const warnings = [...checks.flags]

  // Optional runtime check: mount the working copy in a headless browser and
  // report what the console said. Only when it compiles — an error card has no
  // runtime errors worth reading — and never an image here (that is preview_tool).
  let runtime: RuntimeReport | undefined
  let runtimeFailed = false
  if (args.render && ctx.client === 'mobile') throw new ActionError(403, TOOL_PHONE_REFUSAL)
  if (args.render && build.ok) {
    runtime = runtimeReport(
      await deps.capturePreview(previewRequest(ctx, target, args.name, deps, { image: false })),
    )
    // A frame that stayed blank with nothing logged is, the first time, most
    // often the runtime still warming — asked once more before it is a finding.
    if (runtime.available && !runtime.rendered && runtime.console_errors.length === 0) {
      runtime = runtimeReport(
        await deps.capturePreview(previewRequest(ctx, target, args.name, deps, { image: false })),
      )
    }
    for (const line of runtime.console_errors) warnings.push(`Runtime: ${line}`)
    if (runtime.available && !runtime.rendered) {
      warnings.push('Runtime: the tool did not mount anything within the render budget.')
    }
    runtimeFailed = runtime.console_errors.length > 0 || (runtime.available && !runtime.rendered)
  }

  const review = args.review && build.ok && config ? await reviewTool(ctx, target, config, args.request ?? config.description ?? config.title, deps) : undefined
  if (review?.available && review.verdict && !passes(review.verdict)) warnings.push(`Review: ${review.verdict.score}/10 — work through review.fixes, then check again.`)

  return {
    name: args.name,
    build: buildReport(build),
    ...(runtime ? { runtime } : {}),
    ...(review ? { review } : {}),
    perimeter: config ? describePerimeter(config.perimeter) : [],
    surfaces: describeSurfaces(config),
    requirements: {
      // Missing things never block an install — the tool runs degraded behind a
      // banner, and unsatisfied reads come back empty.
      degraded_here: isDegraded(requirements),
      missing: describeRequirements(requirements),
    },
    checks,
    warnings,
    // A blocking finding stops a publish, and so does a render that failed when
    // one was asked for; flags are what an admin reads.
    ready_to_publish: build.ok && checks.blocking.length === 0 && !runtimeFailed,
  }
}

/**
 * Every screen of a working copy — each section, and each band action pressed
 * — captured and scored by eye (lib/tools/visualReview.ts). Advice only: the
 * verdict gates nothing. Null where the capture or the reviewer is unavailable.
 */
async function reviewTool(ctx: ActionCaller, target: Target, config: ToolConfig, request: string, deps: AppToolDeps) {
  if (ctx.client === 'mobile') throw new ActionError(403, TOOL_PHONE_REFUSAL)
  if (!visualReviewAvailable()) return { available: false as const, reason: 'No reviewer here — OPENROUTER_API_KEY is unset or TOOL_REVIEW=off.' }
  const sections = config.surfaces.nav?.sections ?? []
  const plan: Array<{ screen: string; section?: string; action?: string }> = [
    ...(sections.length ? sections.map((s) => ({ screen: `the ${s.label} section`, section: s.id })) : [{ screen: 'the main page' }]),
    ...(config.surfaces.actions ?? []).map((a) => ({ screen: `the dialog opened by pressing "${a.label}"`, action: a.id, ...(sections[0] ? { section: sections[0].id } : {}) })),
  ]
  // One at a time: each capture is a browser, and several at once starve the
  // server rendering the pages they wait on.
  const shots: Array<{ p: (typeof plan)[number]; shot: ScreenshotResult }> = []
  for (const p of plan) {
    shots.push({
      p,
      shot: await deps.capturePreview({
        ...previewRequest(ctx, target, config.name, deps, { image: true }),
        ...(p.section ? { section: p.section } : {}),
        ...(p.action ? { action: p.action } : {}),
        budgetMs: 25_000,
      }),
    })
  }
  const screens = shots
    .filter(({ shot }) => shot.available && !('navigated_away' in shot && shot.navigated_away) && 'image_base64' in shot && shot.image_base64)
    .map(({ p, shot }) => {
      const img = shot as { image_base64: string; mime: 'image/png' | 'image/jpeg' }
      return { imageBase64: img.image_base64, mime: img.mime, screen: p.screen }
    })
  if (screens.length !== plan.length || shots.some(({ shot }) => shot.available && (('rendered' in shot && !shot.rendered) || ('action_missing' in shot && shot.action_missing)))) {
    const reason = shots.find(({ shot }) => !shot.available)?.shot
    return { available: false as const, reason: reason && !reason.available ? reason.reason : 'Not every screen and band action could be captured.' }
  }
  const result = await reviewScreens({ request, title: config.title }, screens)
  const console_errors = [...new Set(shots.flatMap(({ shot }) => (shot.available ? shot.console_errors : [])))]
  return {
    available: true as const,
    model: reviewModel(),
    verdict: result.verdict,
    passes: result.verdict ? passes(result.verdict) && console_errors.length === 0 : null,
    screens: result.screens.map((s) => ({ screen: s.screen, score: s.verdict?.score ?? null, fixes: s.verdict?.fixes ?? [] })),
    ...(console_errors.length ? { console_errors } : {}),
  }
}

/** A package's base64 at most — the package limit, encoded. */
const PACKAGE_BASE64_MAX = Math.ceil((PACKAGE_LIMITS.maxPackageBytes * 4) / 3) + 4

async function checkPackageAction(
  ctx: ActionCaller,
  args: { space_id: string; content_base64: string; name?: string },
  deps: AppToolDeps = liveDeps,
) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const result = await checkPackage(Buffer.from(args.content_base64, 'base64'), { name: args.name })
  if (!result.ok) refuse(result)
  const checks = checksView(result.report)
  return {
    name: result.name,
    build: buildReport(result.build),
    perimeter: result.build.config ? describePerimeter(result.build.config.perimeter) : [],
    surfaces: describeSurfaces(result.build.config),
    checks,
    ...(result.ignored.length ? { ignored: result.ignored } : {}),
    ready_to_publish: result.build.ok && checks.blocking.length === 0,
  }
}

async function pushToolAction(
  ctx: ActionCaller,
  args: { space_id: string; content_base64: string; name?: string },
  deps: AppToolDeps = liveDeps,
) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const result = await pushPackage(target.principal, target.context, Buffer.from(args.content_base64, 'base64'), { name: args.name })
  if (!result.ok) refuse(result)
  const build = buildReport(result.build)
  return {
    name: result.name,
    created: result.created,
    changed: result.changed,
    removed: result.removed,
    build,
    ...previewLinks(result.name, deps.appOrigin(), target.context.spaceId),
    ...(result.ignored.length ? { ignored: result.ignored } : {}),
    next: build.ok
      ? 'Look at it at preview_url; publish it with publish_tool.'
      : 'It does not compile yet — each error is `file:line:column message`. Fix them and push again.',
  }
}

/** The author guide cut at its `## ` headings, each keyed by a short slug. */
function guideSections(): Array<{ id: string; title: string; body: string }> {
  const parts = TOOL_AUTHOR_GUIDE.split(/\n(?=## )/)
  return parts.slice(1).map((part) => {
    const title = part.slice(3, part.indexOf('\n')).trim()
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return { id, title, body: part.trim() }
  })
}

/** The first lines of the kit catalog: every component and hook in one line each. */
function catalogIndex(): string[] {
  return TOOL_CATALOG.map((e) => `${e.name} — ${e.what}`)
}

/**
 * The manual, a section at a time. The whole of it is tens of thousands of
 * tokens — more than a client will take in one answer, so a model saved it to
 * a file and grepped it — so with no `section` this answers with the part
 * every build needs (start from a template, the file layout) and the index of
 * the rest, and each section is its own call.
 */
async function getToolSdk(_ctx: ActionCaller, args: { section?: string }) {
  const sections = guideSections()
  const section = args.section?.trim().toLowerCase()
  if (section === 'all') {
    return { guide: TOOL_AUTHOR_GUIDE, tool_kit_dts: TOOL_KIT_DTS, catalog: renderCatalog(), bridge_methods: [...BRIDGE_METHODS] }
  }
  if (section === 'types') return { section: 'types', tool_kit_dts: TOOL_KIT_DTS }
  if (section === 'catalog') return { section: 'catalog', catalog: renderCatalog() }
  if (section === 'bridge') return { section: 'bridge', bridge_methods: [...BRIDGE_METHODS] }
  if (section) {
    const found = sections.find((s) => s.id === section || s.id.startsWith(section))
    if (!found) throw new ActionError(400, `No section "${args.section}". Sections: ${[...sections.map((s) => s.id), 'types', 'catalog', 'bridge', 'all'].join(', ')}.`)
    return { section: found.id, text: found.body }
  }
  const intro = TOOL_AUTHOR_GUIDE.split(/\n(?=## )/)[0].trim()
  const start = sections.find((s) => s.id === 'start-from-a-template')
  return {
    read_first: [intro, start?.body].filter(Boolean).join('\n\n'),
    components: catalogIndex(),
    sections: [
      ...sections.filter((s) => s.id !== 'start-from-a-template').map((s) => ({ section: s.id, title: s.title })),
      { section: 'catalog', title: 'Every component and hook with a snippet, and the design rules' },
      { section: 'types', title: 'The @visvine/tool-kit type definitions' },
      { section: 'bridge', title: 'Every bridge method a Tool may call' },
      { section: 'all', title: 'Everything at once (large)' },
    ],
    next: 'Built from a template (plan_tool names one), you rarely need more. Otherwise read `ui-tsx`, `records`, `collections` and `catalog` — get_tool_sdk { section } — before writing code.',
  }
}

async function previewTool(ctx: ActionCaller, args: PreviewToolArgs, deps: AppToolDeps = liveDeps) {
  const { target, detail } = await requireTool(ctx, args.space_id, args.name, deps)
  const report = buildReport(detail.build)
  // The screenshot is opt-in and best-effort: it launches a browser, and where
  // that cannot happen (no Playwright, production without TOOLS_SCREENSHOT=on)
  // the answer says so and the links still stand.
  if (args.screenshot && ctx.client === 'mobile') throw new ActionError(403, TOOL_PHONE_REFUSAL)
  const screenshot = args.screenshot
    ? screenshotReport(
        await deps.capturePreview({
          ...previewRequest(ctx, target, detail.name, deps, { image: true }),
          ...(args.section ? { section: args.section } : {}),
          ...(args.action ? { action: args.action } : {}),
          ...(args.full_page ? { fullPage: true } : {}),
          ...(args.outline ? { outline: true } : {}),
        }),
      )
    : undefined
  return {
    name: detail.name,
    title: detail.title,
    ...previewLinks(detail.name, deps.appOrigin(), target.context.spaceId),
    build: report,
    // Without `screenshot: true` nothing is rendered here — the link is the
    // feedback channel. A tool that does not compile will render an error card.
    renders: report.ok
      ? 'Opening either link renders the working copy in a sandboxed frame.'
      : 'This tool does not compile, so the preview will show an error card. Fix the build first — check_tool lists the errors.',
    ...(screenshot ? { screenshot } : {}),
  }
}

/** The wire shape of a step, checked into the one the browser runs. */
function toStep(raw: {
  do: ToolStep['do']
  target?: { role?: string; name?: string; label?: string; text?: string; placeholder?: string }
  value?: string
  key?: string
  pixels?: number
  ms?: number
  action?: string
}): ToolStep {
  const need = (field: string) => {
    throw new ActionError(400, `A \`${raw.do}\` step needs \`${field}\`.`)
  }
  switch (raw.do) {
    case 'click':
    case 'hover':
      return { do: raw.do, target: raw.target ?? need('target') }
    case 'fill':
    case 'choose':
      return { do: raw.do, target: raw.target ?? need('target'), value: raw.value ?? need('value') }
    case 'press':
      return { do: 'press', key: raw.key ?? need('key'), ...(raw.target ? { target: raw.target } : {}) }
    case 'scroll':
      return { do: 'scroll', ...(raw.pixels !== undefined ? { pixels: raw.pixels } : {}), ...(raw.target ? { target: raw.target } : {}) }
    case 'wait':
      return { do: 'wait', ms: raw.ms ?? need('ms') }
    case 'band':
      return { do: 'band', action: raw.action ?? need('action') }
  }
}

/** A try runs steps and waits on each, so it gets more wall clock than a still. */
const TRY_BUDGET_MS = 30_000

async function tryTool(ctx: ActionCaller, args: TryToolArgs, deps: AppToolDeps = liveDeps) {
  const { target, detail } = await requireTool(ctx, args.space_id, args.name, deps)
  if (ctx.client === 'mobile') throw new ActionError(403, TOOL_PHONE_REFUSAL)
  if (args.steps.length > MAX_TOOL_STEPS) throw new ActionError(400, `At most ${MAX_TOOL_STEPS} steps per try.`)
  const putBack = await deps.rehearse?.(target.context.spaceId, detail.name)
  let result: ScreenshotResult
  let undone: { added: number; changed: number; removed: number } | undefined
  try {
    result = await deps.capturePreview({
      ...previewRequest(ctx, target, detail.name, deps, { image: true }),
      budgetMs: TRY_BUDGET_MS,
      steps: args.steps,
      outline: true,
      ...(args.section ? { section: args.section } : {}),
      ...(args.full_page ? { fullPage: true } : {}),
    })
  } finally {
    undone = await putBack?.()
  }
  const touched = undone && undone.added + undone.changed + undone.removed > 0
  return {
    name: detail.name,
    ...screenshotReport(result),
    ...(touched ? { rehearsal: { ...undone, note: 'The rows this try added, changed or removed have been put back; the preview is as it was.' } } : {}),
  }
}

/** What both render-capable tools hand `capturePreview`: the caller, as themselves. */
function previewRequest(
  ctx: ActionCaller,
  target: Target,
  name: string,
  deps: AppToolDeps,
  opts: { image: boolean },
): ScreenshotRequest {
  return {
    appOrigin: deps.appOrigin(),
    spaceId: target.context.spaceId,
    name,
    viewer: { userId: ctx.userId, name: ctx.name, email: ctx.email },
    image: opts.image,
    budgetMs: SCREENSHOT_BUDGET_MS,
  }
}

interface RuntimeReport {
  available: boolean
  reason?: string
  rendered: boolean
  console_errors: string[]
}

/** The console half of a capture — check_tool's `runtime` block. */
function runtimeReport(result: ScreenshotResult): RuntimeReport {
  if (!result.available) return { available: false, reason: result.reason, rendered: false, console_errors: [] }
  if (result.navigated_away) {
    return {
      available: true,
      rendered: false,
      console_errors: [...result.console_errors, `The page navigated away from the preview to ${result.url}; nothing was rendered.`],
    }
  }
  return { available: true, rendered: result.rendered, console_errors: result.console_errors }
}

/** The whole capture — preview_tool's `screenshot` block. */
function screenshotReport(result: ScreenshotResult) {
  if (!result.available) {
    return { available: false as const, reason: result.reason, console_errors: [] as string[] }
  }
  if (result.navigated_away) {
    // The Tool (or the page) left the preview URL. The capture is pinned to
    // that URL — see lib/tools/screenshot.ts — so there is no image to give.
    return {
      available: true as const,
      navigated_away: true as const,
      url: result.url,
      reason: `The page navigated away from the preview to ${result.url}; the capture only renders /tools/preview/<name>.`,
      console_errors: result.console_errors,
    }
  }
  return {
    available: true as const,
    // Named for what it is: PNG unless the capture had to fall back to JPEG to
    // stay under the size cap — `mime` says which.
    png_base64: result.mime === 'image/png' ? result.image_base64 : null,
    jpeg_base64: result.mime === 'image/jpeg' ? result.image_base64 : null,
    mime: result.mime,
    width: result.width,
    height: result.height,
    rendered: result.rendered,
    console_errors: result.console_errors,
    action_missing: result.action_missing ? 'No band button has that id — declare it in surfaces.actions.' : undefined,
    horizontal_overflow: result.horizontal_overflow
      ? 'The content is wider than the frame — something is cut off or scrolls sideways.'
      : undefined,
    scroll_height: result.scroll_height,
    steps: result.steps,
    outline: result.outline,
    review: REVIEW_CHECKLIST,
  }
}

async function publishTool(ctx: ActionCaller, args: PublishToolArgs, deps: AppToolDeps = liveDeps) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const result = await deps.publishTool(target.principal, target.context, args.name, {
    note: args.note,
    releaseNotes: args.release_notes,
    ...(ctx.deployKey ? { awaitApproval: `the deploy key “${ctx.deployKey.label}”` } : {}),
  })
  if (!result.ok) {
    if (result.report) {
      const blocking = blockingFindings(result.report).map(findingLine)
      throw new ActionError(result.status, [result.error, ...blocking.map((line) => `  ${line}`)].join('\n'))
    }
    refuse(result)
  }
  const approved = result.version.status === 'approved'
  return {
    version_id: result.version.id,
    key: result.version.key,
    version: result.version.version,
    status: result.version.status,
    submitted_at: result.version.submittedAt,
    perimeter: describePerimeter(result.version.perimeter),
    tags: result.version.tags,
    release_notes: result.version.releaseNotes,
    ...previewLinks(args.name, deps.appOrigin(), target.context.spaceId),
    // Where it went, said plainly, because the single most confusing thing an
    // author can believe is that publishing made their tool public. It did not:
    // this space is the whole audience until somebody lists it.
    scope: 'space',
    published:
      approved
        ? 'This snapshot is immutable and is APPROVED in this space: an admin published it, and an admin publishing is the approval. It can be installed here — and shared into this space\'s rooms with `share:` on its index note — and installs of an older version are offered the upgrade. It is NOT listed and no other space can see it.'
        : 'This snapshot is immutable and is now waiting on an admin of this space, who has been notified. Nothing installs until they approve it. It is NOT listed and no other space can see it.',
    marketplace:
      'Listing a tool for other spaces is a separate act by an admin of this space, and a Visvine reviewer then reads the declared perimeter and a code diff. Nothing you do here makes a tool public.',
    checks: checksView(result.report),
    ...(result.warning ? { warning: result.warning } : {}),
  }
}

async function installTool(ctx: ActionCaller, args: InstallToolArgs, deps: AppToolDeps = liveDeps) {
  if (!args.version_id && !args.key) {
    throw new ActionError(400, 'Pass either version_id or key.')
  }
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  let versionId = args.version_id
  if (!versionId) {
    const latest = await deps.latestApprovedVersion(args.key!)
    if (!latest) {
      throw new ActionError(404, `No approved version of "${args.key}" to install.`)
    }
    versionId = latest.id
  }
  const result = await deps.installVersion(
    target.context.spaceId,
    versionId,
    { userId: ctx.userId, email: ctx.email },
    {
      ...(args.placement ? { placement: args.placement } : {}),
      ...(args.bindings ? { bindings: args.bindings } : {}),
      ...(args.settings ? { settings: args.settings } : {}),
    },
  )
  if (!result.ok) refuse(result)
  const slots = Object.keys(result.install.slots).length
    ? bindingsView(result.install, await deps.bindableSpace(target.context.spaceId))
    : undefined
  return {
    slug: result.install.slug,
    key: result.install.key,
    title: result.install.title,
    version: result.install.version,
    enabled: result.install.enabled,
    href: inSpace(target.context.spaceId, `/t/${result.install.slug}`),
    requirements: {
      degraded: result.install.degraded,
      missing: describeRequirements(result.install.requirements),
    },
    ...(slots ? { bindings: slots } : {}),
    ...(Object.keys(result.install.settingSpecs).length ? { settings: settingsView(result.install) } : {}),
    type_claims: result.install.typeClaims,
    // `page` claims the space would not grant: a built-in page stays built in,
    // and a type whose page another install already owns is left alone.
    downgraded_to_tab: result.downgraded,
    conflicts: result.conflicts.map((c) => `"${c.type}" page is already owned by the ${c.heldBy} tool`),
  }
}

interface ConfigureToolArgs {
  space_id: string
  name: string
  facts: Record<string, unknown>
}

/**
 * The structured half of a Tool, changed without rewriting its index.md —
 * surfaces, permissions, bindings, settings, platforms, the kit range,
 * dependencies, collections. Validated as it lands; the build comes back.
 */
/** The keys that are the index note's prose, not facts — `configure_tool` writes them there rather than refusing them. */
const NOTE_KEYS = ['title', 'description', 'tags'] as const

async function configureTool(ctx: ActionCaller, args: ConfigureToolArgs, deps: AppToolDeps = liveDeps) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const prose = z.object({
    title: z.string().trim().min(1).nullable().optional(),
    description: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
  }).safeParse(args.facts)
  if (!prose.success) throw new ActionError(400, prose.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  const stray = Object.keys(args.facts).find((key) => !TOOL_FACT_KEYS.includes(key) && !(NOTE_KEYS as readonly string[]).includes(key))
  if (stray) throw new ActionError(400, `Unknown Tool fact "${stray}".`)
  const noteKeys = NOTE_KEYS.filter((k) => k in args.facts)
  if (noteKeys.length) {
    const detail = await deps.describeAuthoredTool(target.principal, target.context, args.name)
    const index = detail?.sources['index.md']
    if (!detail || !index) throw new ActionError(404, `No tool named "${args.name}".`)
    const front = parseFrontmatter(index)
    for (const k of noteKeys) {
      const v = args.facts[k]
      if (v === null) delete front[k]
      else front[k] = v as never
    }
    const written = await deps.writeToolFile(target.principal, target.context, args.name, 'index.md', joinFrontmatter(front, splitFrontmatter(index).body))
    if (!written.ok) refuse(written)
  }
  const facts = Object.fromEntries(Object.entries(args.facts).filter(([k]) => !(NOTE_KEYS as readonly string[]).includes(k)))
  if (Object.keys(facts).length === 0) {
    const build = await deps.rebuild(target.context.spaceId, args.name)
    const config = build.config
    return { name: args.name, changed: noteKeys, build: buildReport(build), perimeter: config ? describePerimeter(config.perimeter) : [], surfaces: describeSurfaces(config) }
  }
  const result = await deps.configureTool(target.principal, target.context, args.name, facts)
  if (!result.ok) refuse(result)
  const config = result.build.config
  return {
    name: args.name,
    changed: [...noteKeys, ...result.changed],
    build: buildReport(result.build),
    perimeter: config ? describePerimeter(config.perimeter) : [],
    surfaces: describeSurfaces(config),
  }
}

interface UpdateInstallArgs {
  space_id: string
  tool: string
  enabled?: boolean
  type_claims?: Record<string, TypeClaimChoice>
  apply_upgrade?: boolean
  uninstall?: boolean
}

/**
 * The four things an admin does to a Tool the space runs, one per call —
 * switch it on or off, answer its type claims, move it onto the offered
 * upgrade, or uninstall it. Each is its own decision with its own refusals.
 */
async function updateInstall(ctx: ActionCaller, args: UpdateInstallArgs, deps: AppToolDeps = liveDeps) {
  const acts = [
    args.enabled !== undefined,
    args.type_claims !== undefined,
    args.apply_upgrade === true,
    args.uninstall === true,
  ].filter(Boolean).length
  if (acts !== 1) {
    throw new ActionError(400, 'Pass exactly one of enabled, type_claims, apply_upgrade or uninstall.')
  }
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const spaceId = target.context.spaceId
  const installs = await deps.listInstalls(spaceId)
  const install = installs.find((row) => row.id === args.tool || row.slug === args.tool || row.key === args.tool)
  if (!install) throw new ActionError(404, `This space runs no tool "${args.tool}".`)
  const actor = { userId: ctx.userId, email: ctx.email }
  if (args.uninstall) {
    const removed = await deps.uninstall(spaceId, install.id, actor)
    if (!removed.ok) refuse(removed)
    return { slug: install.slug, uninstalled: true }
  }
  const result =
    args.enabled !== undefined
      ? await deps.setInstallEnabled(spaceId, install.id, actor, args.enabled)
      : args.type_claims !== undefined
        ? await deps.setTypeClaims(spaceId, install.id, actor, args.type_claims)
        : await deps.applyUpgrade(spaceId, install.id, actor)
  if (!result.ok) refuse(result)
  return {
    slug: result.install.slug,
    version: result.install.version,
    enabled: result.install.enabled,
    type_claims: result.install.typeClaims,
    upgrade_waiting: result.install.pendingVersion ? `v${result.install.pendingVersion.version}` : null,
    href: inSpace(spaceId, `/t/${result.install.slug}`),
  }
}

/** Each slot an install declares: what it is bound to here, and what this space could bind it to. */
function bindingsView(install: InstallSummary, space: BindableSpace) {
  return Object.fromEntries(
    Object.entries(install.slots).map(([name, slot]) => [
      name,
      {
        kind: slot.kind,
        label: slot.label,
        bound: install.bindings[name] ?? null,
        ...(slot.optional ? { optional: true } : {}),
        choices: bindingChoices(slot, space),
      },
    ]),
  )
}

/** Each setting an install declares, with its value here (unset reads as the default). */
function settingsView(install: InstallSummary) {
  return Object.fromEntries(
    Object.entries(install.settingSpecs).map(([key, spec]) => [
      key,
      {
        label: spec.label,
        type: spec.type,
        value: install.settings[key] ?? spec.default ?? null,
        ...(spec.enum ? { options: spec.enum } : {}),
      },
    ]),
  )
}

interface BindToolArgs {
  space_id: string
  tool: string
  bindings?: Record<string, string>
  settings?: Record<string, unknown>
}

/**
 * Bind an installed Tool's slots to this space's own folders, types,
 * connectors and agents, and set its settings. With neither, it reads: each
 * slot, what it is bound to, and the choices this space offers.
 */
async function bindTool(ctx: ActionCaller, args: BindToolArgs, deps: AppToolDeps = liveDeps) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const spaceId = target.context.spaceId
  const installs = await deps.listInstalls(spaceId)
  const found = installs.find((row) => row.id === args.tool || row.slug === args.tool || row.key === args.tool)
  if (!found) throw new ActionError(404, `This space runs no tool "${args.tool}".`)
  // The choices name every connector and agent the space holds: an admin's to read, as binding is theirs to do.
  if (!target.resolved.isAdmin) throw new ActionError(403, 'Only space admins can bind a tool.')
  let install = found
  if (args.bindings || args.settings) {
    const result = await deps.setInstallBindings(spaceId, found.id, { userId: ctx.userId, email: ctx.email }, {
      ...(args.bindings ? { bindings: args.bindings } : {}),
      ...(args.settings ? { settings: args.settings } : {}),
    })
    if (!result.ok) refuse(result)
    install = result.install
  }
  return {
    slug: install.slug,
    bindings: bindingsView(install, await deps.bindableSpace(spaceId)),
    settings: settingsView(install),
    requirements: { degraded: install.degraded, missing: describeRequirements(install.requirements) },
    href: inSpace(spaceId, `/t/${install.slug}`),
  }
}

/**
 * The handlers on their own, for tests and for scripts/verify-*.ts: no server,
 * no transport, plain JSON in and out. `registerAppTools` is these same
 * functions wrapped in the MCP scope/error gate.
 */
export const appToolHandlers = {
  createTool,
  reviewTool: async (ctx: ActionCaller, args: { space_id: string; name: string; request: string }) => {
    const { target, detail } = await requireTool(ctx, args.space_id, args.name, liveDeps)
    if (!detail.config) throw new ActionError(400, 'The tool does not build — fix it before a review.')
    return reviewTool(ctx, target, detail.config, args.request, liveDeps)
  },
  listTools,
  readTool,
  writeTool,
  checkTool,
  getToolSdk,
  previewTool,
  publishTool,
  installTool,
  updateInstall,
  configureTool,
  bindTool,
}


// ── the actions ───────────────────────────────────────────────────────────────

const spaceArg = z
  .string()
  .describe('The space to author in — list_spaces returns the ids you can act in')

const nameArg = z
  .string()
  .describe("The tool's name: lower-case letters, digits and hyphens, e.g. 'deal-pipeline'")

const fileArg = z
  .union([z.enum(TOOL_FILES), z.string().regex(TOOL_MODULE_RE, 'a module is src/<name>.tsx or .ts') as z.ZodType<`src/${string}`>])
  .describe(
    "'index.md' (frontmatter = config, body = docs), 'ui.tsx' (the React interface), 'data.js' (server-side handlers), " +
      "or a module of the interface's own, 'src/<name>.tsx' (imported from ui.tsx as './src/<name>'; writing it empty removes it)",
  )

/** The paragraph every authoring action needs an agent to have read once. */
/**
 * What the author reads a capture against before handing the link over — the
 * faults a person spots in a second and a model misses unless it is told to look.
 */
const REVIEW_CHECKLIST =
  'Look at the image before you hand over the link, and fix anything that fails: ' +
  '1) full bleed — no border, rounded box or card around the whole Tool; ' +
  '2) spacing — every field and button sits inside the gutter, nothing touches an edge, nothing wraps mid-word; ' +
  '3) nothing cut off or overlapping; ' +
  '4) the main act is a band button and works again after the first time; ' +
  '5) every known set of values is a Select or Segmented, never a text box; ' +
  '6) each view is a section on the band, not a tab strip inside the frame; ' +
  '7) no sentence explains the screen; ' +
  '8) a Tool taller than its frame scrolls (`scroll_height`) — pass `full_page: true` to see all of it; nothing is squeezed to fit; ' +
  '9) one size and one shape for one thing — a colour is a Swatch everywhere, a repeated piece is one component.'

/** The loop every build ends with — said in create_tool, write_tool and preview_tool. */
const REVIEW_LOOP =
  'BEFORE YOU HAND OVER THE LINK: run check_tool with `render: true`, then preview_tool with `screenshot: true` ' +
  'once per section (`section`) and once with each band button pressed (`action`) so the dialog it opens is shot. ' +
  'Read every image against the review list in the answer and fix what fails. Then USE it: try_tool with the ' +
  'steps a person would take for the main act (fill the form, choose from each Select, press save) and read ' +
  'the outline and image after — a Tool nobody looked at, or nobody used, is not done.'

const TOOL_SHAPE =
  'A Tool is three notes in the space: `tools/<name>/index.md` (frontmatter is the config — title, ' +
  'description, `surfaces:` and `perimeter:` — and the body is documentation), `ui.tsx` (a React ' +
  'component, default export, compiled server-side on every write) and `data.js` (optional handlers ' +
  'that run server-side). It renders in the main content area only, inside a sandboxed frame, and can ' +
  'reach Visvine ONLY through the bridge, within the reach `perimeter:` declares — and never beyond ' +
  'what the person looking at it could already read. Read get_tool_sdk before writing any code.'

/**
 * The Tool actions: the authoring loop (get_tool_sdk → create → write → check →
 * preview → publish), the roster, and the install.
 *
 * They sit in the same catalogue as everything else, and what separates
 * building a Tool from reading someone's notes is the scope each one declares,
 * not which endpoint a client reached. Authoring rides `tools:author` and never
 * `context:write` — a token granted to tidy notes must not be able to add a
 * running app to a space's sidebar — and installing runs code nobody in the
 * space wrote, so it gets `tools:install` of its own.
 */
export const APP_ACTIONS = [
  defineAction({
    name: 'create_tool',
    scope: 'tools:author',
    guides: ['tool_design', 'tool_data'],
    summary: 'Scaffold a new Tool in a space — the entity, its config note and two source files that already compile.',
    description:
      `BEFORE YOU CALL THIS: run plan_tool — it reads the space and returns the plan to agree with the person. ${intakeSummary('tool')}\n` +
      'Scaffold a new Tool in a space: the directory entity, its config note and two source files that ' +
      `already compile and render. Start here when asked to build something for a space. ${TOOL_SHAPE} ` +
      'Returns the file list, a preview link, and a pointer to get_tool_sdk. The name must be unique in ' +
      `the space; edit the files afterwards with write_tool. ${REVIEW_LOOP}`,
    input: {
      space_id: spaceArg,
      name: nameArg,
      title: z.string().describe('Display name, e.g. "Deal Pipeline" — shown on the rail row and the marketplace card'),
      description: z
        .string()
        .describe('One sentence on what it does. This is the marketplace card and the install checklist.'),
      plan: z
        .string()
        .max(8000)
        .optional()
        .describe("plan_tool's plan_template, filled in and agreed with the person — written into index.md as its ## Design section"),
      template: z
        .string()
        .optional()
        .describe(`Start from a finished Tool instead of a blank one — ${TOOL_TEMPLATES.map((t) => t.id).join(', ')}. plan_tool names the one that fits and its spec guide. Needs \`spec\`.`),
      spec: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("The template's SPEC: what THIS Tool is about — nouns, fields, options, sample rows (plan_tool's template.spec_guide and template.example)"),
    },
    run: (ctx, args) => createTool(ctx, args),
  }),

  defineAction({
    name: 'list_tools',
    scope: 'context:read',
    summary: 'The Tools authored in a space and the ones installed there from the marketplace.',
    description:
      "Everything Tool-shaped in one space: the tools AUTHORED here (with build status, so you can see " +
      'which ones compile) and the tools INSTALLED here from the marketplace (with slug, version and ' +
      'whether they are running degraded). Read this before creating one, so you extend an existing tool ' +
      'rather than duplicating it.',
    input: { space_id: spaceArg },
    annotations: { readOnlyHint: true },
    run: (ctx, args) => listTools(ctx, args),
  }),

  defineAction({
    name: 'read_tool',
    scope: 'context:read',
    summary: "Read a Tool's source back as plain code, with its parsed config and current build diagnostics.",
    description:
      "Read a tool's source back — `index.md` verbatim, and `ui.tsx`/`data.js` as plain code (the notes " +
      'store them inside fenced blocks; this unwraps them, and write_tool takes the same plain form). ' +
      'Also returns the parsed config and the current build diagnostics. Read before you edit: write_tool ' +
      'replaces a whole file.',
    input: {
      space_id: spaceArg,
      name: nameArg,
      file: fileArg.optional().describe('Only this file — omit for all three'),
    },
    annotations: { readOnlyHint: true },
    run: (ctx, args) => readTool(ctx, args),
  }),

  defineAction({
    name: 'write_tool',
    scope: 'tools:author',
    guides: ['tool_design', 'tool_charts'],
    summary: "Replace one of a Tool's three files and get the fresh build back in the same answer.",
    description:
      "Write one of a tool's three files, replacing it, and get the fresh build back in the same answer — " +
      'that is the authoring loop: write, read the diagnostics, write again. `build.ok` is true when it ' +
      'compiles; otherwise `build.errors` holds lines like `ui.tsx:12:5 Expected ">" but found "class"`, ' +
      'and `build.config_error` holds anything wrong with the frontmatter in `index.md`. A tool only ' +
      'runs when the config parses AND `ui.tsx` compiles; a broken `data.js` also takes the build down. ' +
      "In `ui.tsx` only `react`, `react-dom` and `@visvine/tool-kit` are importable — every other import " +
      'is refused at compile time. In `data.js` assign each operation to `handlers.<name>`. ' +
      'Writes obey your own note permissions, so this is refused wherever an ordinary note write would be. ' +
      'Every write also returns the preview link — hand it to the person you are working for so they can ' +
      `watch the tool take shape. ${REVIEW_LOOP}`,
    input: {
      space_id: spaceArg,
      name: nameArg,
      file: fileArg,
      content: z.string().describe('The complete new contents of that file'),
    },
    run: (ctx, args) => writeTool(ctx, args),
  }),

  defineAction({
    name: 'configure_tool',
    scope: 'tools:author',
    summary: "Change a Tool's structured facts — surfaces, permissions, bindings, settings — without rewriting index.md.",
    description:
      "Change the structured half of a Tool: `surfaces`, `permissions` (context, records, resources, connectors, agents, " +
      'types, actions, ai, ui), `bindings` (slots the installing space fills: folder, type, connector, agent — referenced ' +
      'as `$name` in permissions), `settings` (install-time values an admin sets), `platforms` (web, desktop), `sdk`, ' +
      '`dependencies`, `collections`, `release`, `license`. Each key given replaces that key; null removes it. Checked ' +
      "as it lands — a malformed value is refused with the reason — and the build comes back. `title`, `description` and " +
      "`tags` are the index note's, and are written into its frontmatter. Setting a manifest-2 key on a Tool that still declares `perimeter` moves its " +
      'reach into `permissions`.',
    input: {
      space_id: spaceArg,
      name: nameArg,
      facts: z.record(z.string(), z.unknown()).describe('The facts to set, e.g. { "permissions": { "context": { "read": ["$notes/**"] } } }'),
    },
    run: (ctx, args) => configureTool(ctx, args),
  }),

  defineAction({
    name: 'check_tool',
    scope: 'tools:author',
    summary: 'Recompile and lint a Tool before publishing — config, diagnostics, declared reach, and a one-line verdict.',
    description:
      'Recompile a tool and lint it before you publish: config errors, compile diagnostics, a plain-English ' +
      'summary of the reach its perimeter declares, which of the connectors/types/agents it names this ' +
      "space actually has (it still installs when they're missing — it just runs degraded), what surfaces " +
      'it asks to occupy, and warnings worth fixing (an empty perimeter, a page claim that will be ' +
      'downgraded to a tab, a missing description). `ready_to_publish` is the one-line verdict. Pass ' +
      '`render: true` to also mount the working copy in a headless browser and get back its console ' +
      'errors and whether it rendered (`runtime`) — no image; that is preview_tool. Where headless ' +
      'rendering is unavailable, `runtime.available` is false and says why.',
    input: {
      space_id: spaceArg,
      name: nameArg,
      render: z
        .boolean()
        .optional()
        .describe('Also render the preview headlessly and report runtime console errors (slower — a browser launches)'),
      review: z
        .boolean()
        .optional()
        .describe('Also screenshot every section and band action and have a designer model score them 0–10 with concrete fixes (`review`). Hand over at 8.5+.'),
      request: z.string().max(2000).optional().describe('What the person asked for, so the review judges fit as well as looks'),
    },
    run: (ctx, args) => checkTool(ctx, args),
  }),

  defineAction({
    name: 'check_package',
    scope: 'tools:author',
    summary: 'Build and check a .vvtool package — the compile and checks a push and a publish would run — writing nothing.',
    description:
      'Build a `.vvtool` package (visvine-tool.json, src/ui.tsx, src/data.js, src/<module>.tsx, README.md, …) ' +
      'exactly as a working copy is built, and run the same compatibility and security checks a publish runs — ' +
      'without writing anything anywhere. What `visvine-tool check` asks. `ready_to_publish` is the verdict.',
    input: {
      space_id: spaceArg,
      content_base64: z.string().max(PACKAGE_BASE64_MAX).describe('The package, base64'),
      name: z.string().optional().describe('Check it under this name instead of the manifest\'s'),
    },
    annotations: { readOnlyHint: true },
    run: (ctx, args) => checkPackageAction(ctx, args),
  }),

  defineAction({
    name: 'push_tool',
    scope: 'tools:author',
    summary: 'A .vvtool package into a space as its working copy — made, or brought in line — answering with the build.',
    description:
      'Push a `.vvtool` package as the working copy of the tool it names in `space_id`: made when the space has no ' +
      'tool of that name, updated in place when it has one you may edit. Only what changed is written, each file ' +
      'through the same gates as write_tool; a module or icon the package no longer carries is removed. A name taken ' +
      'elsewhere is refused — change it in visvine-tool.json. Answers with the build and where to preview it; ' +
      'publish_tool publishes it. What `visvine-tool push` asks.',
    input: {
      space_id: spaceArg,
      content_base64: z.string().max(PACKAGE_BASE64_MAX).describe('The package, base64'),
      name: z.string().optional().describe('Push it under this name instead of the manifest\'s'),
    },
    run: (ctx, args) => pushToolAction(ctx, args),
  }),

  defineAction({
    name: 'get_tool_sdk',
    scope: 'context:read',
    summary: 'The manual for writing a Visvine Tool: the authoring guide, the tool-kit type definitions, and the bridge methods.',
    description:
      'The manual for writing a Visvine Tool: the authoring guide (file layout, frontmatter, the perimeter, ' +
      'the limits), the TypeScript definitions for `@visvine/tool-kit` (the components, hooks and the ' +
      'context/connector/agent client a tool imports), and the list of bridge methods a tool may call. ' +
      'Read this once before writing any tool code — the API is small and specific, and guessing it wastes ' +
      'a compile round trip. With no `section` it answers with what every build needs and the index of the rest; ' +
      'ask for a section by its id (`ui-tsx`, `records`, `catalog`, `types`, …).',
    input: {
      section: z.string().max(60).optional().describe('One section of the manual, by id from the index — or `all` for everything (large)'),
    },
    annotations: { readOnlyHint: true },
    run: (ctx, args) => getToolSdk(ctx, args),
  }),

  defineAction({
    name: 'preview_tool',
    scope: 'tools:author',
    summary: 'Where to look at a Tool: a desktop deep link, the web URL, its build status, and optionally a rendered screenshot.',
    description:
      'Where to look at a tool: a `visvine-desktop://` deep link that opens it in the desktop app and the ' +
      'equivalent web URL, plus its current build status. Hand these to the person you are working for. ' +
      'Pass `screenshot: true` to also render the preview headlessly AS YOU (1024×768, ~20s budget) and get ' +
      'back the image (`screenshot.png_base64`, or `jpeg_base64` when it had to shrink — `mime` says which), ' +
      'whether the tool mounted, and every console error the page and the frame logged. Where headless ' +
      'rendering is unavailable (no Playwright, or production without TOOLS_SCREENSHOT=on) `screenshot.available` ' +
      'is false with a reason and the links still stand. `section` opens one of the Tool\'s sections first; ' +
      '`action` presses one of its band buttons first, so the dialog it opens is in the shot. The answer carries ' +
      '`review`, the list to read the image against, and flags `horizontal_overflow` when content is cut off.',
    input: {
      space_id: spaceArg,
      name: nameArg,
      screenshot: z
        .boolean()
        .optional()
        .describe('Render the preview headlessly and return the image plus console errors (slower — a browser launches)'),
      section: z.string().max(64).optional().describe('With screenshot: the surfaces.nav section id to open before capturing'),
      action: z.string().max(64).optional().describe('With screenshot: the surfaces.actions id to press before capturing'),
      full_page: z.boolean().optional().describe('With screenshot: capture the Tool\'s whole scrolled height, not only the first screen'),
      outline: z.boolean().optional().describe('With screenshot: also return the page\'s accessibility outline as text — every heading, button, field and value'),
    },
    annotations: { readOnlyHint: true },
    run: (ctx, args) => previewTool(ctx, args),
  }),

  defineAction({
    name: 'try_tool',
    scope: 'tools:author',
    summary: 'Use a Tool\'s working copy as a person would — click, fill, choose, scroll — then see the result.',
    description:
      'Drive the preview headlessly AS YOU, the way a person would, and read back what happened: after the ' +
      'steps run, the answer carries the image, the page\'s accessibility `outline` (every heading, button, ' +
      'field and its value, as text), each step\'s outcome, and every console error. Steps run in order and stop ' +
      'at the first that fails, saying why. Targets are named as a person sees them, never by selector: ' +
      '`{ role: "button", name: "Submit vote" }`, `{ label: "Company" }`, `{ text: "Azonic" }`, ' +
      '`{ placeholder: "Search companies" }`. Steps: `click`, `hover`, `fill` (value), `choose` (a Select by its ' +
      'label, then the option named `value`), `press` (key, optional target), `scroll` (pixels, or a target to ' +
      'bring into view), `wait` (ms), `band` (press a band button by its `action` id — the main act, e.g. New deal, lives there). A try is a ' +
      'REHEARSAL for the Tool\'s own collections and state: whatever its steps add, change or delete there is put back after the ' +
      'capture (`rehearsal` counts it), so test freely — there is nothing to clean up, and the sample rows stay. Notes and records ' +
      'the Tool writes through the space are real and stay. Where headless rendering is unavailable `available` is false with a reason.',
    input: {
      space_id: spaceArg,
      name: nameArg,
      steps: z
        .array(
          z.object({
            do: z.enum(['click', 'hover', 'fill', 'choose', 'press', 'scroll', 'wait', 'band']),
            action: z.string().max(64).optional().describe("band: the id of the band button to press (surfaces.actions) — e.g. 'new'"),
            target: z
              .object({
                role: z.string().max(40).optional().describe('ARIA role: button, link, combobox, textbox, checkbox, tab, option, radio…'),
                name: z.string().max(200).optional().describe('The accessible name with `role` — the button\'s text, the field\'s label'),
                label: z.string().max(200).optional().describe('A field by its label'),
                text: z.string().max(200).optional().describe('Any visible text'),
                placeholder: z.string().max(200).optional().describe('An input by its placeholder'),
              })
              .optional(),
            value: z.string().max(2000).optional().describe('fill: the text to type · choose: the option to pick'),
            key: z.string().max(40).optional().describe('press: a key, e.g. Enter, Escape, ArrowDown'),
            pixels: z.number().int().min(-20000).max(20000).optional().describe('scroll: how far, down when positive'),
            ms: z.number().int().min(0).max(3000).optional().describe('wait: how long'),
          }),
        )
        .min(1)
        .max(MAX_TOOL_STEPS)
        .describe('What to do, in order'),
      section: z.string().max(64).optional().describe('The surfaces.nav section to open first'),
      full_page: z.boolean().optional().describe('Capture the whole scrolled height after the steps'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (ctx, args) => tryTool(ctx, { ...args, steps: args.steps.map(toStep) }),
  }),

  defineAction({
    name: 'publish_tool',
    scope: 'tools:author',
    summary: 'Publish the working copy as an immutable version into ITS OWN SPACE. Never the marketplace.',
    description:
      'Publish the working copy as an immutable version, INTO THE SPACE IT WAS WRITTEN IN and nowhere ' +
      'else. This does NOT put the tool on the marketplace and does not make it visible to any other ' +
      'space — a tool written in a private space stays private. Only when it compiles; run check_tool ' +
      'first. If you are a space admin the version is approved as it lands and can be installed here (its ' +
      'rooms get it through `share:` on its index note); if you are a member it waits for one of your admins, who is ' +
      'notified — that is how an UPDATE to an already-installed tool is queued, and re-publishing simply ' +
      'supersedes your earlier submission. Installs of an older version in this space are offered the ' +
      'upgrade, which an admin still applies by hand. Listing it for other spaces is a separate, ' +
      'deliberate act by a space admin, reviewed by Visvine.',
    input: {
      space_id: spaceArg,
      name: nameArg,
      note: z.string().optional().describe('A note for whoever approves it — what changed and why'),
      release_notes: z
        .string()
        .max(2048)
        .optional()
        .describe('Release notes for the people who install it — what this version changes (≤2KB; shown on the card and in the version history)'),
    },
    run: (ctx, args) => publishTool(ctx, args),
  }),

  defineAction({
    name: 'install_tool',
    scope: 'tools:install',
    summary: 'Install an approved version of a tool into a space. Space admins only.',
    description:
      'Install an approved version of a tool into a space — this space\'s own, or one listed for every ' +
      'space. SPACE ADMINS ONLY. Identify it by version_id, or by key (`<source-space-id>/<name>`) to take ' +
      'the newest LISTED version. `placement` puts its rail row on the rail (default) or in More. Returns the install ' +
      'slug and its `/t/<slug>` page, the requirements this space does not satisfy (which never block the ' +
      'install — the tool runs degraded behind a banner and unsatisfied reads come back empty), and any ' +
      'type-page claims that were downgraded to a tab or refused because another install owns them.',
    input: {
      space_id: spaceArg,
      version_id: z.string().optional().describe('The exact version to install, from the marketplace'),
      key: z
        .string()
        .optional()
        .describe("The tool's key, e.g. 'space_abc/deal-pipeline' — installs its newest listed version"),
      placement: z.enum(['rail', 'more']).optional().describe('On the rail (default) or tucked into More'),
      bindings: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "What each of the tool's binding slots is bound to in this space — a folder path, a type, connector or agent name, e.g. { deals: 'sales/pipeline' }. A slot left out takes the tool's suggestion when this space has it; bind_tool changes them later",
        ),
      settings: z.record(z.string(), z.unknown()).optional().describe("The tool's install settings; unset ones take their defaults"),
    },
    run: (ctx, args) => installTool(ctx, args),
  }),

  defineAction({
    name: 'bind_tool',
    scope: 'tools:install',
    summary: "Bind an installed tool's slots to this space's folders, types, connectors and agents, and set its settings.",
    description:
      "A tool declares the KIND of thing it needs — a folder, a type, a connector, an agent — and each space binds " +
      'its own. SPACE ADMINS ONLY for a change. Name the install by slug, key or id. Pass `bindings` ({ slot: value }) ' +
      'and/or `settings` ({ key: value }): named ones change, the rest keep theirs, and an empty value clears an ' +
      'optional slot. Pass neither to read each slot, what it is bound to and the choices this space offers. A slot ' +
      'left unbound runs the tool degraded; the reach it grants is the bound one, re-checked on every call.',
    input: {
      space_id: spaceArg,
      tool: z.string().min(1).describe('The install: its slug, its key or its id'),
      bindings: z
        .record(z.string(), z.string())
        .optional()
        .describe("{ slot: value } — a folder path (e.g. 'sales/pipeline'), or a type, connector or agent name"),
      settings: z.record(z.string(), z.unknown()).optional().describe('{ key: value } for the settings it declares'),
    },
    run: (ctx, args) => bindTool(ctx, args),
  }),

  defineAction({
    name: 'update_install',
    scope: 'tools:install',
    summary: 'Switch an installed tool on or off, answer its type claims, apply its upgrade, or uninstall it.',
    description:
      'Change a tool this space runs. SPACE ADMINS ONLY. Name it by slug, key or install id, and pass exactly ' +
      'one of: `enabled` (switch it on or off — its rail row stays placed), `type_claims` ({ type: page | tab } ' +
      'for the type surfaces it declared), `apply_upgrade: true` (move onto the approved version waiting for it, ' +
      'after reading what it adds), or `uninstall: true` (its rail row and stored state go; notes it wrote stay).',
    annotations: { destructiveHint: true },
    input: {
      space_id: spaceArg,
      tool: z.string().min(1).describe('The install to change: its slug, its key or its id'),
      enabled: z.boolean().optional().describe('On or off'),
      type_claims: z
        .record(z.string(), z.enum(['page', 'tab', 'none']))
        .optional()
        .describe('For each type it declared: its page, a tab on the page, or none'),
      apply_upgrade: z.boolean().optional().describe('Move onto the offered upgrade'),
      uninstall: z.boolean().optional().describe('Remove it from the space'),
    },
    run: (ctx, args) => updateInstall(ctx, args),
  }),
]
