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
import { advisoriesFor } from '@/lib/tools/advisories'
import { BRIDGE_METHODS } from '@/lib/tools/protocol'
import { TOOL_PHONE_REFUSAL } from '@/lib/tools/clientClass'
import { describeRequirements, isDegraded, sourceRequirements } from '@/lib/tools/requirements'
import { TOOL_AUTHOR_GUIDE, TOOL_KIT_DTS } from '@/lib/tools/sdkDocs'
import { renderCatalog } from '@/lib/tools/catalog'
import { bindableSpace as bindableSpaceService } from '@/lib/tools/bindable'
import { bindingChoices, type BindableSpace, type BindingValues } from '@visvine/tool-protocol/bindings'
import {
  captureToolPreview,
  SCREENSHOT_BUDGET_MS,
  type ScreenshotRequest,
  type ScreenshotResult,
} from '@/lib/tools/screenshot'
import {
  configureTool as configureToolService,
  createTool as createToolService,
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
}

const liveDeps: AppToolDeps = {
  resolveTarget: (ctx, spaceId) => resolveTarget(ctx, spaceId),
  featureAccessForbidden: (userId, spaceId, email) =>
    featureAccessForbidden(userId, spaceId, 'directory', email),
  listAuthoredTools: listAuthoredToolsService,
  describeAuthoredTool: describeAuthoredToolService,
  createTool: createToolService,
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
}
interface PreviewToolArgs {
  space_id: string
  name: string
  /** Render the preview headlessly and return the image + console errors. */
  screenshot?: boolean
  section?: string
  action?: string
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

// ── handlers ──────────────────────────────────────────────────────────────────

async function createTool(ctx: ActionCaller, args: CreateToolArgs, deps: AppToolDeps = liveDeps) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const result = await deps.createTool(target.principal, target.context, {
    name: args.name,
    title: args.title,
    description: args.description,
  })
  if (!result.ok) refuse(result)
  return {
    name: result.name,
    files: SCAFFOLDED_FILES.map((file) => `tools/${result.name}/${file}`),
    build: buildReport(result.build),
    ...previewLinks(result.name, deps.appOrigin(), target.context.spaceId),
    next: [
      'Call get_tool_sdk once — it returns the authoring guide, the @visvine/tool-kit type definitions and the bridge method list.',
      `Then write_tool { name: "${result.name}", file: "ui.tsx", content } and read the build it hands back.`,
      'Declare everything the tool touches in index.md `perimeter:` — the bridge refuses anything undeclared.',
      'Style with the kit components and the --vv-* theme tokens, and never paint a page background — the frame is transparent so the app’s own backdrop shows through.',
    ],
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
    for (const line of runtime.console_errors) warnings.push(`Runtime: ${line}`)
    if (runtime.available && !runtime.rendered) {
      warnings.push('Runtime: the tool did not mount anything within the render budget.')
    }
    runtimeFailed = runtime.console_errors.length > 0 || (runtime.available && !runtime.rendered)
  }

  return {
    name: args.name,
    build: buildReport(build),
    ...(runtime ? { runtime } : {}),
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

async function getToolSdk(_ctx: ActionCaller, _args: Record<string, never>) {
  return {
    guide: TOOL_AUTHOR_GUIDE,
    tool_kit_dts: TOOL_KIT_DTS,
    // The kit's components and hooks with snippets, and the design rules — build
    // from these and the Tool looks like the app (lib/tools/catalog.ts).
    catalog: renderCatalog(),
    // Everything a tool can ask the host for. `ui.tsx` reaches these through
    // @visvine/tool-kit; `data.js` gets the same set as isolate capabilities.
    bridge_methods: [...BRIDGE_METHODS],
    files: {
      'index.md':
        'Frontmatter is the config (type, title, description, surfaces, perimeter); the body is documentation for humans.',
      'ui.tsx':
        'React/TSX, compiled on write. The default export is mounted. Only react, react-dom and @visvine/tool-kit are importable.',
      'data.js':
        'Optional server-side handlers. Assign one function per operation to `handlers.<name>`; the interface calls them by name through `data.call`.',
    },
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
async function configureTool(ctx: ActionCaller, args: ConfigureToolArgs, deps: AppToolDeps = liveDeps) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const result = await deps.configureTool(target.principal, target.context, args.name, args.facts)
  if (!result.ok) refuse(result)
  const config = result.build.config
  return {
    name: args.name,
    changed: result.changed,
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
  '7) no sentence explains the screen.'

/** The loop every build ends with — said in create_tool, write_tool and preview_tool. */
const REVIEW_LOOP =
  'BEFORE YOU HAND OVER THE LINK: run check_tool with `render: true`, then preview_tool with `screenshot: true` ' +
  'once per section (`section`) and once with each band button pressed (`action`) so the dialog it opens is shot. ' +
  'Read every image against the review list in the answer and fix what fails. A Tool nobody looked at is not done.'

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
    guides: ['tool_design'],
    summary: 'Scaffold a new Tool in a space — the entity, its config note and two source files that already compile.',
    description:
      `BEFORE YOU CALL THIS: ${intakeSummary('tool')}\n` +
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
    guides: ['tool_design'],
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
      "as it lands — a malformed value is refused with the reason — and the build comes back. Title, description and " +
      "tags stay in index.md (write_tool). Setting a manifest-2 key on a Tool that still declares `perimeter` moves its " +
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
      'a compile round trip.',
    input: {},
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
      'Pass `screenshot: true` to also render the preview headlessly AS YOU (1024×768, ~10s budget) and get ' +
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
    },
    annotations: { readOnlyHint: true },
    run: (ctx, args) => previewTool(ctx, args),
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
