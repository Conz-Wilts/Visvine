/**
 * The authoring loop over MCP: nine tools that let an external coding agent
 * (Claude Code, Cursor) build a Visvine Tool without a checkout of this repo.
 *
 *   learn    get_tool_sdk               the guide, the .d.ts and the bridge surface
 *   author   create_tool, write_tool    scaffold, then edit one file at a time
 *   verify   check_tool, read_tool      compile + lint, read back what is stored
 *   see it   preview_tool, list_tools   where it renders, what exists here
 *   ship     publish_tool, install_tool the review gate and the marketplace
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
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { withCtx, McpError, type McpContext } from '@/lib/mcp/auth'
import { resolveTarget, type Target } from '@/lib/mcp/context'
import type { McpServerKind } from '@/lib/mcp/config'
import { featureAccessForbidden } from '@/lib/auth'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { toBuildSummary, rebuildTool, toolDiagnosticLine, type BuildSummary } from '@/lib/tools/builds'
import type { ToolConfig } from '@/lib/tools/config'
import { appOrigin as liveAppOrigin } from '@/lib/tools/origin'
import { describePerimeter, perimeterIsEmpty } from '@/lib/tools/perimeter'
import { BRIDGE_METHODS } from '@/lib/tools/protocol'
import { computeRequirements, describeRequirements, isDegraded } from '@/lib/tools/requirements'
import { TOOL_AUTHOR_GUIDE, TOOL_KIT_DTS } from '@/lib/tools/sdkDocs'
import {
  captureToolPreview,
  SCREENSHOT_BUDGET_MS,
  type ScreenshotRequest,
  type ScreenshotResult,
} from '@/lib/tools/screenshot'
import {
  createTool as createToolService,
  describeAuthoredTool as describeAuthoredToolService,
  listAuthoredTools as listAuthoredToolsService,
  writeToolFile as writeToolFileService,
  type AuthoredToolDetail,
  type AuthoredToolSummary,
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
  installVersion as installVersionService,
  listInstalls as listInstallsService,
  spaceFacts as spaceFactsService,
  type InstallResult,
  type InstallSummary,
  type SpaceFacts,
} from '@/lib/tools/installs'

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
  resolveTarget(ctx: McpContext, spaceId: string): Promise<Target>
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
  ): Promise<InstallResult>
  listInstalls(spaceId: string): Promise<InstallSummary[]>
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
  resolveTarget: (ctx, spaceId) => resolveTarget(ctx, spaceId, 'shared'),
  featureAccessForbidden: (userId, spaceId, email) =>
    featureAccessForbidden(userId, spaceId, 'tools', email),
  listAuthoredTools: listAuthoredToolsService,
  describeAuthoredTool: describeAuthoredToolService,
  createTool: createToolService,
  writeToolFile: writeToolFileService,
  rebuild: async (spaceId, name) => toBuildSummary(await rebuildTool(spaceId, name)),
  publishTool: publishToolService,
  installVersion: installVersionService,
  listInstalls: listInstallsService,
  latestApprovedVersion: async (key) => {
    // versionHistory is newest-first, so the first approved row is the newest.
    const history = await versionHistoryService(key)
    return history.find((v) => v.status === 'approved') ?? null
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
 * Where the author can look at what they just wrote. Both forms every time: the
 * desktop app opens the deep link in place, and anything else (a browser, a
 * terminal that only prints links) needs the URL.
 */
function previewLinks(name: string, origin: string) {
  return {
    desktop_deep_link: `visvine-desktop://open/tools/preview/${name}`,
    preview_url: `${origin}/tools/preview/${name}`,
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
  throw new McpError(result.status, result.error)
}

/**
 * The same gate every other Tools door enforces — REST routes
 * (`requireToolsAccess`) and the bridge (`forbiddenForTools`) both refuse a
 * space that switched the `tools` feature off before touching the service;
 * MCP authoring must too, or it becomes the one door left standing.
 */
async function requireToolsFeature(ctx: McpContext, target: Target, deps: AppToolDeps): Promise<void> {
  if (await deps.featureAccessForbidden(ctx.userId, target.context.spaceId, ctx.email)) {
    throw new McpError(403, 'The Tools feature is not available to you in this space')
  }
}

/** The target plus the tool it names, or a 404 that says how to find one. */
async function requireTool(
  ctx: McpContext,
  spaceId: string,
  name: string,
  deps: AppToolDeps,
): Promise<{ target: Target; detail: AuthoredToolDetail }> {
  const target = await deps.resolveTarget(ctx, spaceId)
  await requireToolsFeature(ctx, target, deps)
  const detail = await deps.describeAuthoredTool(target.principal, target.context, name)
  if (!detail) {
    throw new McpError(404, `No tool named "${name}" here — list_tools shows what exists.`)
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
}

// ── handlers ──────────────────────────────────────────────────────────────────

async function createTool(ctx: McpContext, args: CreateToolArgs, deps: AppToolDeps = liveDeps) {
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
    ...previewLinks(result.name, deps.appOrigin()),
    next: [
      'Call get_tool_sdk once — it returns the authoring guide, the @visvine/tool-kit type definitions and the bridge method list.',
      `Then write_tool { name: "${result.name}", file: "ui.tsx", content } and read the build it hands back.`,
      'Declare everything the tool touches in index.md `perimeter:` — the bridge refuses anything undeclared.',
    ],
  }
}

async function listTools(ctx: McpContext, args: ListToolsArgs, deps: AppToolDeps = liveDeps) {
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

async function readTool(ctx: McpContext, args: ReadToolArgs, deps: AppToolDeps = liveDeps) {
  const { detail } = await requireTool(ctx, args.space_id, args.name, deps)
  const wanted = args.file ? { [args.file]: detail.sources[args.file] } : detail.sources
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

async function writeTool(ctx: McpContext, args: WriteToolArgs, deps: AppToolDeps = liveDeps) {
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

async function checkTool(ctx: McpContext, args: CheckToolArgs, deps: AppToolDeps = liveDeps) {
  const { target, detail } = await requireTool(ctx, args.space_id, args.name, deps)
  const build = await deps.rebuild(target.context.spaceId, args.name)
  const config = build.config ?? detail.config

  const warnings: string[] = []
  if (!config) {
    warnings.push('index.md does not parse as a tool config, so nothing below could be checked.')
  }
  if (config && perimeterIsEmpty(config.perimeter)) {
    warnings.push(
      'The perimeter is empty — this tool can read and write no space data. Declare note globs in `perimeter.read`/`perimeter.write` and any node types, connectors and agents it uses.',
    )
  }
  if (config && !config.description.trim()) {
    warnings.push(
      'index.md has no `description:` — it is what the marketplace card and the install checklist show.',
    )
  }
  // A write glob under `agents/` buys nothing on its own: the seal is create-only
  // and scoped to the briefs of agents the config DECLARES. Without that list the
  // glob is inert, and the author gets no other signal that it is.
  if (
    config &&
    config.perimeter.agents.length === 0 &&
    config.perimeter.write.some((glob) => glob.split('/')[0] === 'agents')
  ) {
    warnings.push(
      '`perimeter.write` names a path under `agents/` but `perimeter.agents` is empty, so the glob grants nothing. The only permitted write there is CREATING the brief of an agent this tool declares.',
    )
  }

  const facts = await deps.spaceFacts(target.principal, target.context)
  const custom = new Set(facts.customTypes)
  for (const claim of config?.surfaces.types ?? []) {
    if (claim.mode !== 'page' || custom.has(claim.type)) continue
    // parseToolConfig already refuses `page` on a built-in type, so what is
    // left is a page claim on a type this space simply hasn't invented: the
    // install resolves it down to a tab rather than refusing.
    warnings.push(
      `\`surfaces.types\` claims the page for "${claim.type}", which is not a member-invented type in this space — installing will downgrade it to a tab.`,
    )
  }

  const requirements = config
    ? computeRequirements(config.perimeter, facts.available)
    : { connectors: [], types: [], agents: [] }

  // Optional runtime check: mount the working copy in a headless browser and
  // report what the console said. Only when it compiles — an error card has no
  // runtime errors worth reading — and never an image here (that is preview_tool).
  let runtime: RuntimeReport | undefined
  if (args.render && build.ok) {
    runtime = runtimeReport(
      await deps.capturePreview(previewRequest(ctx, target, args.name, deps, { image: false })),
    )
    for (const line of runtime.console_errors) warnings.push(`Runtime: ${line}`)
    if (runtime.available && !runtime.rendered) {
      warnings.push('Runtime: the tool did not mount anything within the render budget.')
    }
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
    warnings,
    ready_to_publish: build.ok && warnings.length === 0,
  }
}

async function getToolSdk(_ctx: McpContext, _args: Record<string, never>) {
  return {
    guide: TOOL_AUTHOR_GUIDE,
    tool_kit_dts: TOOL_KIT_DTS,
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

async function previewTool(ctx: McpContext, args: PreviewToolArgs, deps: AppToolDeps = liveDeps) {
  const { target, detail } = await requireTool(ctx, args.space_id, args.name, deps)
  const report = buildReport(detail.build)
  // The screenshot is opt-in and best-effort: it launches a browser, and where
  // that cannot happen (no Playwright, production without TOOLS_SCREENSHOT=on)
  // the answer says so and the links still stand.
  const screenshot = args.screenshot
    ? screenshotReport(await deps.capturePreview(previewRequest(ctx, target, detail.name, deps, { image: true })))
    : undefined
  return {
    name: detail.name,
    title: detail.title,
    ...previewLinks(detail.name, deps.appOrigin()),
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
  ctx: McpContext,
  target: Target,
  name: string,
  deps: AppToolDeps,
  opts: { image: boolean },
): ScreenshotRequest {
  return {
    appOrigin: deps.appOrigin(),
    spaceId: target.context.spaceId,
    name,
    viewer: { userId: ctx.userId, name: ctx.name, email: ctx.email, personId: ctx.personId },
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
  }
}

async function publishTool(ctx: McpContext, args: PublishToolArgs, deps: AppToolDeps = liveDeps) {
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  const result = await deps.publishTool(target.principal, target.context, args.name, {
    note: args.note,
    releaseNotes: args.release_notes,
  })
  if (!result.ok) refuse(result)
  return {
    version_id: result.version.id,
    key: result.version.key,
    version: result.version.version,
    status: result.version.status,
    submitted_at: result.version.submittedAt,
    perimeter: describePerimeter(result.version.perimeter),
    tags: result.version.tags,
    release_notes: result.version.releaseNotes,
    // The review gate, stated because an author will otherwise wait for a
    // marketplace entry that is not coming yet — unless the trusted-publisher
    // fast path already approved it (same perimeter as the last approved
    // version, from a space the operator trusts).
    review:
      result.version.status === 'approved'
        ? 'This snapshot is immutable and was AUTO-APPROVED: this space is a trusted publisher and the declared perimeter is unchanged from the last approved version. It is installable now; spaces running an older version are offered the upgrade.'
        : 'This snapshot is immutable and now PENDING review by a Visvine super-admin, who sees the declared perimeter and a diff of the code against the last approved version. It is not installable by anyone until it is approved, and publishing again is refused while this one is in the queue.',
    ...(result.warning ? { warning: result.warning } : {}),
  }
}

async function installTool(ctx: McpContext, args: InstallToolArgs, deps: AppToolDeps = liveDeps) {
  if (!args.version_id && !args.key) {
    throw new McpError(400, 'Pass either version_id or key.')
  }
  const target = await deps.resolveTarget(ctx, args.space_id)
  await requireToolsFeature(ctx, target, deps)
  let versionId = args.version_id
  if (!versionId) {
    const latest = await deps.latestApprovedVersion(args.key!)
    if (!latest) {
      throw new McpError(404, `No approved version of "${args.key}" to install.`)
    }
    versionId = latest.id
  }
  const result = await deps.installVersion(target.context.spaceId, versionId, {
    userId: ctx.userId,
    email: ctx.email,
  })
  if (!result.ok) refuse(result)
  return {
    slug: result.install.slug,
    key: result.install.key,
    title: result.install.title,
    version: result.install.version,
    enabled: result.install.enabled,
    href: `/t/${result.install.slug}`,
    requirements: {
      degraded: result.install.degraded,
      missing: describeRequirements(result.install.requirements),
    },
    type_claims: result.install.typeClaims,
    // `page` claims the space would not grant: a built-in page stays built in,
    // and a type whose page another install already owns is left alone.
    downgraded_to_tab: result.downgraded,
    conflicts: result.conflicts.map((c) => `"${c.type}" page is already owned by the ${c.heldBy} tool`),
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
}

// ── registration ──────────────────────────────────────────────────────────────

const spaceArg = z
  .string()
  .describe('The space to author in — list_spaces returns the ids you can act in')

const nameArg = z
  .string()
  .describe("The tool's name: lower-case letters, digits and hyphens, e.g. 'deal-pipeline'")

const fileArg = z
  .enum(TOOL_FILES)
  .describe(
    "'index.md' (frontmatter = config, body = docs), 'ui.tsx' (the React interface) or 'data.js' (server-side handlers)",
  )

/** The paragraph every authoring tool needs an agent to have read once. */
const TOOL_SHAPE =
  'A Tool is three notes in the space: `tools/<name>/index.md` (frontmatter is the config — title, ' +
  'description, `surfaces:` and `perimeter:` — and the body is documentation), `ui.tsx` (a React ' +
  'component, default export, compiled server-side on every write) and `data.js` (optional handlers ' +
  'that run server-side). It renders in the main content area only, inside a sandboxed frame, and can ' +
  'reach Visvine ONLY through the bridge, within the reach `perimeter:` declares — and never beyond ' +
  'what the person looking at it could already read. Call get_tool_sdk before writing any code.'

/**
 * Which server is registering: the CONTEXT server gets the two tools that
 * discover and activate Tools in a space (list_tools, install_tool); the
 * CREATOR server gets the whole authoring loop (list_tools again, so an author
 * can see what exists, plus get_tool_sdk, create/read/write/check/preview/
 * publish_tool). install_tool is deliberately NOT on the creator server: putting
 * someone else's code in front of a space's members is a space-admin act done
 * from the everyday connection, not part of building.
 */
export function registerAppTools(
  server: McpServer,
  surface: McpServerKind,
  deps: AppToolDeps = liveDeps,
): void {
  const authoring = surface === 'creator'

  // ── Author ──────────────────────────────────────────────────────────────

  if (authoring) server.registerTool(
    'create_tool',
    {
      description:
        'Scaffold a new Tool in a space: the directory entity, its config note and two source files that ' +
        `already compile and render. Start here when asked to build something for a space. ${TOOL_SHAPE} ` +
        'Returns the file list, a preview link, and a pointer to get_tool_sdk. The name must be unique in ' +
        'the space; edit the files afterwards with write_tool.',
      inputSchema: {
        space_id: spaceArg,
        name: nameArg,
        title: z.string().describe('Display name, e.g. "Deal Pipeline" — shown on the rail row and the marketplace card'),
        description: z
          .string()
          .describe('One sentence on what it does. This is the marketplace card and the install checklist.'),
      },
    },
    (args, extra) => withCtx(extra, 'create_tool', (ctx) => createTool(ctx, args, deps)),
  )

  server.registerTool(
    'list_tools',
    {
      description:
        "Everything Tool-shaped in one space: the tools AUTHORED here (with build status, so you can see " +
        'which ones compile) and the tools INSTALLED here from the marketplace (with slug, version and ' +
        'whether they are running degraded). Call this before creating one, so you extend an existing tool ' +
        'rather than duplicating it.',
      inputSchema: { space_id: spaceArg },
      annotations: { readOnlyHint: true },
    },
    (args, extra) => withCtx(extra, 'list_tools', (ctx) => listTools(ctx, args, deps)),
  )

  if (authoring) server.registerTool(
    'read_tool',
    {
      description:
        "Read a tool's source back — `index.md` verbatim, and `ui.tsx`/`data.js` as plain code (the notes " +
        'store them inside fenced blocks; this unwraps them, and write_tool takes the same plain form). ' +
        'Also returns the parsed config and the current build diagnostics. Read before you edit: write_tool ' +
        'replaces a whole file.',
      inputSchema: {
        space_id: spaceArg,
        name: nameArg,
        file: fileArg.optional().describe('Only this file — omit for all three'),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) => withCtx(extra, 'read_tool', (ctx) => readTool(ctx, args, deps)),
  )

  if (authoring) server.registerTool(
    'write_tool',
    {
      description:
        "Write one of a tool's three files, replacing it, and get the fresh build back in the same answer — " +
        'that is the authoring loop: write, read the diagnostics, write again. `build.ok` is true when it ' +
        'compiles; otherwise `build.errors` holds lines like `ui.tsx:12:5 Expected ">" but found "class"`, ' +
        'and `build.config_error` holds anything wrong with the frontmatter in `index.md`. A tool only ' +
        'runs when the config parses AND `ui.tsx` compiles; a broken `data.js` also takes the build down. ' +
        "In `ui.tsx` only `react`, `react-dom` and `@visvine/tool-kit` are importable — every other import " +
        'is refused at compile time. In `data.js` assign each operation to `handlers.<name>`. ' +
        'Writes obey your own note permissions, so this is refused wherever an ordinary note write would be.',
      inputSchema: {
        space_id: spaceArg,
        name: nameArg,
        file: fileArg,
        content: z.string().describe('The complete new contents of that file'),
      },
    },
    (args, extra) => withCtx(extra, 'write_tool', (ctx) => writeTool(ctx, args, deps)),
  )

  if (authoring) server.registerTool(
    'check_tool',
    {
      description:
        'Recompile a tool and lint it before you publish: config errors, compile diagnostics, a plain-English ' +
        'summary of the reach its perimeter declares, which of the connectors/types/agents it names this ' +
        "space actually has (it still installs when they're missing — it just runs degraded), what surfaces " +
        'it asks to occupy, and warnings worth fixing (an empty perimeter, a page claim that will be ' +
        'downgraded to a tab, a missing description). `ready_to_publish` is the one-line verdict. Pass ' +
        '`render: true` to also mount the working copy in a headless browser and get back its console ' +
        'errors and whether it rendered (`runtime`) — no image; that is preview_tool. Where headless ' +
        'rendering is unavailable, `runtime.available` is false and says why.',
      inputSchema: {
        space_id: spaceArg,
        name: nameArg,
        render: z
          .boolean()
          .optional()
          .describe('Also render the preview headlessly and report runtime console errors (slower — a browser launches)'),
      },
    },
    (args, extra) => withCtx(extra, 'check_tool', (ctx) => checkTool(ctx, args, deps)),
  )

  if (authoring) server.registerTool(
    'get_tool_sdk',
    {
      description:
        'The manual for writing a Visvine Tool: the authoring guide (file layout, frontmatter, the perimeter, ' +
        'the limits), the TypeScript definitions for `@visvine/tool-kit` (the components, hooks and the ' +
        'context/connector/agent client a tool imports), and the list of bridge methods a tool may call. ' +
        'Call this once before writing any tool code — the API is small and specific, and guessing it wastes ' +
        'a compile round trip.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    // No `deps`: the SDK is two static documents and a method list.
    (args, extra) => withCtx(extra, 'get_tool_sdk', (ctx) => getToolSdk(ctx, args)),
  )

  if (authoring) server.registerTool(
    'preview_tool',
    {
      description:
        'Where to look at a tool: a `visvine-desktop://` deep link that opens it in the desktop app and the ' +
        'equivalent web URL, plus its current build status. Hand these to the person you are working for. ' +
        'Pass `screenshot: true` to also render the preview headlessly AS YOU (1024×768, ~10s budget) and get ' +
        'back the image (`screenshot.png_base64`, or `jpeg_base64` when it had to shrink — `mime` says which), ' +
        'whether the tool mounted, and every console error the page and the frame logged. Where headless ' +
        'rendering is unavailable (no Playwright, or production without TOOLS_SCREENSHOT=on) `screenshot.available` ' +
        'is false with a reason and the links still stand.',
      inputSchema: {
        space_id: spaceArg,
        name: nameArg,
        screenshot: z
          .boolean()
          .optional()
          .describe('Render the preview headlessly and return the image plus console errors (slower — a browser launches)'),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) => withCtx(extra, 'preview_tool', (ctx) => previewTool(ctx, args, deps)),
  )

  // ── Marketplace ─────────────────────────────────────────────────────────

  if (authoring) server.registerTool(
    'publish_tool',
    {
      description:
        'Publish the working copy as an immutable version and queue it for review. SPACE ADMINS ONLY, and ' +
        'only when the tool compiles. It does NOT go live: a Visvine super-admin reviews the declared ' +
        'perimeter and a code diff first, and only an approved version can be installed anywhere. One ' +
        'pending version per tool — withdraw it in the app before publishing again. Run check_tool first. ' +
        'The marketplace card also shows `tags:` and `preview:` from index.md and the release notes you pass ' +
        'here. Exception to the queue: a space listed as a trusted publisher whose new version declares the ' +
        'SAME perimeter as its last approved one is auto-approved.',
      inputSchema: {
        space_id: spaceArg,
        name: nameArg,
        note: z.string().optional().describe('A note for the reviewer — what changed and why'),
        release_notes: z
          .string()
          .max(2048)
          .optional()
          .describe('Release notes for the people who install it — what this version changes (≤2KB; shown on the card and in the version history)'),
      },
    },
    (args, extra) => withCtx(extra, 'publish_tool', (ctx) => publishTool(ctx, args, deps)),
  )

  if (!authoring) server.registerTool(
    'install_tool',
    {
      description:
        'Install an approved marketplace version into a space. SPACE ADMINS ONLY. Identify it by version_id, ' +
        'or by key (`<source-space-id>/<name>`) to take the newest approved version. Returns the install ' +
        'slug and its `/t/<slug>` page, the requirements this space does not satisfy (which never block the ' +
        'install — the tool runs degraded behind a banner and unsatisfied reads come back empty), and any ' +
        'type-page claims that were downgraded to a tab or refused because another install owns them.',
      inputSchema: {
        space_id: spaceArg,
        version_id: z.string().optional().describe('The exact version to install, from the marketplace'),
        key: z
          .string()
          .optional()
          .describe("The tool's marketplace key, e.g. 'space_abc/deal-pipeline' — installs its newest approved version"),
      },
    },
    (args, extra) => withCtx(extra, 'install_tool', (ctx) => installTool(ctx, args, deps)),
  )
}
