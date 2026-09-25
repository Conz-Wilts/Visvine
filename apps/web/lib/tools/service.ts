/**
 * The Tools feature's service file — one place touching the Tool notes and the
 * build rows, mirroring lib/agents/service.ts and lib/connectors/service.ts.
 * The REST routes, the MCP authoring tools and the author UI call this; nothing
 * else writes a Tool's notes.
 *
 * This is the WORKING COPY half of the feature: `tools/<name>/` in a space's
 * shared context, compiled on every write. Publishing a snapshot to the
 * marketplace and installing one are the registry's business, not this file's.
 *
 * Everything here takes an explicit `ContextPrincipal` and writes through
 * `writeGated`, so a Tool's source obeys exactly the grants, restricted folders
 * and write denials any other note does — authoring a Tool is authoring notes.
 * Two consequences worth stating out loud:
 *
 *  • Members author. There is no admin-only clause on `tools/` (unlike
 *    `connectors/`), because a Tool cannot do anything its viewer's own grants
 *    would not already allow — see lib/tools/perimeter.ts.
 *  • Writes are stamped with the human origin `edit`, never `agent`: `tools/`
 *    is frozen for AI origins (contextService.lockedDenial) precisely so an
 *    autonomous sweep cannot rewrite executable code, and a person driving an
 *    authoring agent is authoring, not sweeping.
 *
 * A Tool is also a directory node (`tool:<name>`), created here before its
 * index note: the note store holds an entity folder's index to its entity
 * contract (store.ts#enforceIndexContract), so the note only keeps `type: tool`
 * once the node behind it exists.
 */
import prisma from '@/lib/prisma'
import { readVisible, visibleVault, writeDenialFull, writeGated } from '@/lib/notes/contextService'
import { removeEntityNode, spaceNodeId, syncEntityNode } from '@/lib/notes/context/entityNodes'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { shareTargets } from '@/lib/spaces/subspaces'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { canRemove, type ResolvedContext } from '@/lib/notes/resolve'
import * as store from '@/lib/notes/store'
import { SHARED_OWNER_KEY, type Actor, type Context } from '@/lib/notes/store'
import { computeRequirements, type ToolRequirements } from './requirements'
import { removeInstallForTool, spaceFacts } from './installs'
import type { ToolPerimeter } from './perimeter'
import { latestPublications, toolKey, type ToolPublicationSummary } from './registry'
import { toolFolderIn } from './location'
import {
  getBuild,
  listBuilds,
  rebuildTool,
  toBuildSummary,
  toolDiagnosticLine,
  type BuildSummary,
} from './builds'
import {
  TOOL_NAME_RE,
  TOOL_SOURCE_FILES,
  newToolIndexNote,
  parseToolConfig,
  toolDataPath,
  toolIconPath,
  declaresTool,
  toolFolderOfIndex,
  toolNameOfFolder,
  toolIndexPath,
  toolUiPath,
  unwrapSource,
  wrapSource,
  type ToolConfig,
} from './config'
import { draftAuthorship, type DraftAuthorship } from './draftAuthors'

/** The files an author addresses, whatever the notes behind them are called. */
export type ToolFileName = 'index.md' | 'ui.tsx' | 'data.js' | 'icon.svg'

const INDEX_FILE: ToolFileName = 'index.md'

/** One authored Tool on the roster. A broken one still lists — with its error. */
export interface AuthoredToolSummary {
  name: string
  /** The config note: `tools/<name>/index.md`. */
  path: string
  /** The directory node standing for this Tool. */
  nodeId: string
  title: string
  description: string
  /** 0 until the Tool has ever been published. */
  version: number
  /** The config's parse error, or null. */
  invalid: string | null
  createdBy: string | null
  /** Null only for a Tool that has never compiled (no source has been written). */
  build: BuildSummary | null
  /**
   * The newest published version of this Tool, whatever its status — pending,
   * rejected and withdrawn included. Null when it has never been published.
   */
  publication: ToolPublicationSummary | null
  /** Which sub-spaces this Tool is installed into by `share:` (lib/tools/share.ts). */
  share?: 'none' | 'all' | string[]
}

export interface AuthoredToolDetail extends AuthoredToolSummary {
  config: ToolConfig | null
  /**
   * The author's files. `index.md` is the note verbatim; the sources are
   * unwrapped out of their fenced code blocks. A source note that isn't a
   * wrapped source at all comes back as its raw markdown rather than as null —
   * that is a state the author has to see to fix. `icon.svg` is null for a Tool
   * that uses one of the built-in rail shapes, which is most of them.
   *
   * WARNING: these are the author's files VERBATIM, including `icon.svg`, which
   * is the one place unsanitized author markup leaves the server. It is here so
   * an author can read back what they wrote and fix it. **Never render it as
   * HTML.** Anything that draws a Tool's icon must read the build's `iconSvg`
   * (sanitized by lib/tools/iconSvg.ts), the way features/tools/components/toolIcons.tsx does.
   */
  sources: Record<ToolFileName, string | null>
  /**
   * Who wrote this working copy since it was last approved (lib/tools/draftAuthors.ts).
   * A preview runs with the reach they all share, and starts by itself only for
   * one of them; anyone else presses Run.
   */
  draft: DraftAuthorship
}

type ToolServiceError = { ok: false; status: number; error: string }
export type CreateToolResult = { ok: true; name: string; build: BuildSummary } | ToolServiceError
export type WriteToolFileResult =
  | { ok: true; path: string; build: BuildSummary }
  | ToolServiceError

function actorOf(p: ContextPrincipal): Actor {
  return { id: p.userId, name: p.name, email: p.email || null }
}

/** `tool:<name>` — the directory node id, which is also the install rail key. */
function toolNodeId(name: string): string {
  return `tool:${name}`
}

function badName(name: string): ToolServiceError {
  return {
    ok: false,
    status: 400,
    error: `"${name}" is not a valid tool name — use lower-case letters, digits and hyphens (63 max).`,
  }
}

/** The note behind an author-facing filename. */
function notePathOf(name: string, file: ToolFileName, folder: string): string {
  if (file === TOOL_SOURCE_FILES.ui.authorName) return toolUiPath(name, folder)
  if (file === TOOL_SOURCE_FILES.data.authorName) return toolDataPath(name, folder)
  if (file === TOOL_SOURCE_FILES.icon.authorName) return toolIconPath(name, folder)
  return toolIndexPath(name, folder)
}

/** What actually goes in the note: the two sources ride inside a fenced block. */
function noteContentOf(file: ToolFileName, content: string): string {
  if (file === TOOL_SOURCE_FILES.ui.authorName) return wrapSource(content, TOOL_SOURCE_FILES.ui.lang)
  if (file === TOOL_SOURCE_FILES.data.authorName) {
    return wrapSource(content, TOOL_SOURCE_FILES.data.lang)
  }
  if (file === TOOL_SOURCE_FILES.icon.authorName) {
    return wrapSource(content, TOOL_SOURCE_FILES.icon.lang)
  }
  return content
}

/** Tools live in the shared context only; a personal copy is somebody's draft. */
function isShared(context: Context): boolean {
  return context.ownerKey === SHARED_OWNER_KEY
}

function summarise(
  name: string,
  indexPath: string,
  indexContent: string,
  createdBy: string | null,
  build: BuildSummary | null,
  publication: ToolPublicationSummary | null,
): AuthoredToolSummary {
  const fm = parseFrontmatter(indexContent)
  const parsed = parseToolConfig(fm, name)
  const config = parsed.ok ? parsed.config : null
  return {
    name,
    path: indexPath,
    nodeId: toolNodeId(name),
    title: config?.title || (typeof fm.title === 'string' && fm.title.trim()) || name,
    description:
      config?.description ?? (typeof fm.description === 'string' ? fm.description.trim() : ''),
    version: config?.version ?? 0,
    invalid: parsed.ok ? null : parsed.error,
    createdBy,
    build,
    publication,
    share: shareTargets(fm),
  }
}

/** Who created each of these notes, in one query. */
async function authorsOf(spaceId: string, paths: string[]): Promise<Map<string, string | null>> {
  if (paths.length === 0) return new Map()
  const rows = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, path: { in: paths }, deletedAt: null },
    select: { path: true, createdBy: true },
  })
  return new Map(rows.map((row) => [row.path, row.createdBy]))
}

// ── reading ───────────────────────────────────────────────────────────────────

/** Every Tool authored in this space that the principal can see. */
export async function listAuthoredTools(
  p: ContextPrincipal,
  context: Context,
): Promise<AuthoredToolSummary[]> {
  if (!isShared(context)) return []
  const { raws } = await visibleVault(p, context)
  // Wherever the space filed them: `tools/<name>/` or a folder of its own
  // whose index declares `type: tool` — `tools/` wins a name held twice.
  const seen = new Set<string>()
  const indexes = raws
    .map((raw) => ({ raw, folder: toolFolderOfIndex(raw.path, declaresTool(raw.content)) }))
    .sort((a, b) => Number(!a.raw.path.startsWith('tools/')) - Number(!b.raw.path.startsWith('tools/')))
    .flatMap(({ raw, folder }) => {
      const name = folder ? toolNameOfFolder(folder) : null
      if (!name || seen.has(name)) return []
      seen.add(name)
      return [{ ...raw, name }]
    })
  const names = indexes.map((raw) => raw.name)
  const [authors, builds, publications] = await Promise.all([
    authorsOf(
      context.spaceId,
      indexes.map((raw) => raw.path),
    ),
    listBuilds(context.spaceId),
    latestPublications(names.map((name) => toolKey(context.spaceId, name))),
  ])
  const out: AuthoredToolSummary[] = []
  for (const raw of indexes) {
    const name = raw.name
    const build = builds.get(name)
    out.push(
      summarise(
        name,
        raw.path,
        raw.content,
        authors.get(raw.path) ?? null,
        build ? toBuildSummary(build) : null,
        publications.get(toolKey(context.spaceId, name)) ?? null,
      ),
    )
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** One Tool with its config, its three files and its build. Null if unreadable. */
export async function describeAuthoredTool(
  p: ContextPrincipal,
  context: Context,
  name: string,
): Promise<AuthoredToolDetail | null> {
  if (!isShared(context) || !TOOL_NAME_RE.test(name)) return null
  const folder = await toolFolderIn(context.spaceId, name)
  const indexContent = await readVisible(p, context, toolIndexPath(name, folder))
  if (indexContent === null) return null

  const key = toolKey(context.spaceId, name)
  const [uiNote, dataNote, iconNote, authors, build, publications, draft] = await Promise.all([
    readVisible(p, context, toolUiPath(name, folder)),
    readVisible(p, context, toolDataPath(name, folder)),
    readVisible(p, context, toolIconPath(name, folder)),
    authorsOf(context.spaceId, [toolIndexPath(name, folder)]),
    getBuild(context.spaceId, name),
    latestPublications([key]),
    draftAuthorship(context.spaceId, name, folder),
  ])
  const summary = summarise(
    name,
    toolIndexPath(name, folder),
    indexContent,
    authors.get(toolIndexPath(name, folder)) ?? null,
    build ? toBuildSummary(build) : null,
    publications.get(key) ?? null,
  )
  const parsed = parseToolConfig(parseFrontmatter(indexContent), name)
  return {
    ...summary,
    config: parsed.ok ? parsed.config : null,
    sources: {
      'index.md': indexContent,
      'ui.tsx': uiNote === null ? null : (unwrapSource(uiNote)?.code ?? uiNote),
      'data.js': dataNote === null ? null : (unwrapSource(dataNote)?.code ?? dataNote),
      'icon.svg': iconNote === null ? null : (unwrapSource(iconNote)?.code ?? iconNote),
    },
    draft,
  }
}

/**
 * What this space fails to satisfy of a working copy's declared reach — the
 * author's checklist, before anything is published or installed.
 *
 * Read under the AUTHOR's own principal, like check_tool's lint and unlike an
 * install's (which reads under the acting admin's): an author who cannot see a
 * connector could not have written a Tool against it either, so telling them it
 * is there would be telling them about something they cannot use. `spaceFacts`
 * (lib/tools/installs.ts) is the one reading of "what does this space have" —
 * install/upgrade/recheck and check_tool read it under their own principals, so
 * an author's checklist and an admin's install checklist can't disagree.
 */
export async function toolRequirementsInSpace(
  p: ContextPrincipal,
  context: Context,
  perimeter: ToolPerimeter,
): Promise<ToolRequirements> {
  const facts = await spaceFacts(p, context)
  return computeRequirements(perimeter, facts.available)
}

// ── creating ──────────────────────────────────────────────────────────────────

/** The starting `ui.tsx`: renders, compiles, and shows where to type. */
function starterUi(title: string): string {
  return [
    `// This is your tool's interface. It renders inside Visvine's main content`,
    `// area, in a sandboxed frame — React and @visvine/tool-kit are importable,`,
    `// nothing else is. The default export is what gets mounted.`,
    ``,
    `const TITLE = ${JSON.stringify(title)}`,
    ``,
    `export default function App() {`,
    `  return (`,
    `    <main style={{ padding: 24 }}>`,
    `      <h1>{TITLE}</h1>`,
    `      <p>Edit ui.tsx to build this tool.</p>`,
    `    </main>`,
    `  )`,
    `}`,
  ].join('\n')
}

/** The starting `data.js`: one handler, so the shape is obvious. */
function starterData(): string {
  return [
    `// Server-side logic for this tool. It runs in a sandbox with no network of`,
    `// its own: everything it may reach is declared in the tool's perimeter.`,
    `// Assign one function per operation to \`handlers\`; the interface calls`,
    `// them by name.`,
    ``,
    `handlers.hello = async (args, ctx) => {`,
    `  return { greeting: 'Hello, ' + (args.name || 'world') }`,
    `}`,
  ].join('\n')
}

/**
 * Create a new Tool: the directory node, the config note, and the two source
 * scaffolds. Refuses a bad name, a name already taken, and a principal who
 * can't write there.
 *
 * The node comes first on purpose. `tools/<name>/index.md` is an entity
 * folder's index, and the store holds those to their entity's contract — with
 * no node behind it the store would treat the note as an ordinary folder's
 * home page, strip nothing back in, and the config would stop resolving to a
 * Tool on the very first save.
 */
export async function createTool(
  p: ContextPrincipal,
  context: Context,
  input: { name: string; title?: string; description?: string; railLabel?: string },
): Promise<CreateToolResult> {
  const name = input.name.trim().toLowerCase()
  if (!TOOL_NAME_RE.test(name)) return badName(name)
  if (!isShared(context)) {
    return { ok: false, status: 400, error: 'Tools are authored in a space, not in personal context.' }
  }

  // A Tool of this name filed in a folder of the space's own is this name taken.
  const folder = await toolFolderIn(context.spaceId, name)
  const indexPath = toolIndexPath(name, folder)
  // Every path this call will write is checked BEFORE anything is created, so a
  // denial can never leave a half-made Tool (node + index, no sources) behind
  // that 409s on the retry. Denial reasons are per-path (a note-level
  // writeDenial can seal one file and not its sibling), hence all three.
  for (const path of [
    indexPath,
    notePathOf(name, TOOL_SOURCE_FILES.ui.authorName, folder),
    notePathOf(name, TOOL_SOURCE_FILES.data.authorName, folder),
  ]) {
    const denial = await writeDenialFull(p, context, path)
    if (denial) return { ok: false, status: 403, error: denial }
  }

  if (await store.readNoteOrNull(context, indexPath)) {
    return { ok: false, status: 409, error: `A tool named "${name}" already exists.` }
  }

  // Node ids are global slugs, so the id this Tool needs may already belong to
  // another space's node. Better to say the name is taken than to let the store
  // fail to find the node and quietly strip the config off the index note.
  const nodeId = toolNodeId(name)
  const clash = await prisma.node.findUnique({ where: { id: nodeId }, select: { spaceId: true } })
  if (clash && clash.spaceId !== context.spaceId) {
    return { ok: false, status: 409, error: `The name "${name}" is taken — try another.` }
  }

  const title = (input.title ?? '').trim() || name
  const description = (input.description ?? '').trim()
  await syncEntityNode({
    spaceId: context.spaceId,
    type: 'tool',
    nodeId,
    name: title,
    subtitle: description || null,
    metadata: { notePath: indexPath },
    parentNodeId: spaceNodeId(context.spaceId),
    actor: actorOf(p),
  })

  try {
    // createIndexFolder rather than a plain write: the Tool IS its folder, and
    // this is the one call that makes the folder row, the index and the parent
    // listing all appear together.
    await store.createIndexFolder(
      context,
      folder,
      newToolIndexNote({ name, title, description, railLabel: input.railLabel }),
      actorOf(p),
    )
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : 'Could not create the tool.' }
  }

  for (const [file, content] of [
    [TOOL_SOURCE_FILES.ui.authorName, starterUi(title)] as const,
    [TOOL_SOURCE_FILES.data.authorName, starterData()] as const,
  ]) {
    const written = await writeGated(p, context, notePathOf(name, file, folder), noteContentOf(file, content))
    // Pre-checked above; only a grant revoked mid-call can land here.
    if (written.status === 'denied') return { ok: false, status: 403, error: written.reason }
  }

  // Each write above already rebuilt through the store hook; this returns that
  // row (the hash is unchanged, so nothing recompiles).
  return { ok: true, name, build: toBuildSummary(await rebuildTool(context.spaceId, name)) }
}

// ── writing ───────────────────────────────────────────────────────────────────

/**
 * Write one of a Tool's three files and hand back the build it produced, so the
 * author learns on the write whether their code compiles. The write goes
 * through the note gate under the principal — grants, restricted folders and
 * `writeDenial` all apply exactly as they do to any note.
 */
export async function writeToolFile(
  p: ContextPrincipal,
  context: Context,
  name: string,
  file: ToolFileName,
  content: string,
): Promise<WriteToolFileResult> {
  if (!TOOL_NAME_RE.test(name)) return badName(name)
  if (!isShared(context)) {
    return { ok: false, status: 400, error: 'Tools are authored in a space, not in personal context.' }
  }
  const folder = await toolFolderIn(context.spaceId, name)
  if (!(await store.readNoteOrNull(context, toolIndexPath(name, folder)))) {
    return { ok: false, status: 404, error: `No tool named "${name}" — create it first.` }
  }

  const path = notePathOf(name, file, folder)
  let written
  try {
    written = await writeGated(p, context, path, noteContentOf(file, content))
  } catch (err) {
    // The store refuses some writes by throwing (an index that can't convert, a
    // sub-note with no entity behind it). Those are the author's problem to
    // read, not a 500.
    return { ok: false, status: 400, error: err instanceof Error ? err.message : `Could not write ${file}.` }
  }
  if (written.status === 'denied') return { ok: false, status: 403, error: written.reason }

  // The store hook has already rebuilt; this reads that row back.
  return { ok: true, path, build: toBuildSummary(await rebuildTool(context.spaceId, name)) }
}

/**
 * Remove a Tool's own icon, falling it back to whatever built-in shape its
 * frontmatter names.
 *
 * A separate call rather than `writeToolFile(name, 'icon.svg', '')`: an empty
 * icon note is a broken icon note, and the build would (correctly) report it as
 * one. "I don't want a custom icon any more" means the file goes away.
 *
 * Gated on the same write permission as writing it — the check is
 * `writeDenialFull` on the icon's own path, so a member who cannot write into
 * this Tool's folder cannot clear its icon either.
 */
export async function deleteToolIcon(
  p: ContextPrincipal,
  context: ResolvedContext,
  name: string,
): Promise<WriteToolFileResult> {
  if (!TOOL_NAME_RE.test(name)) return badName(name)
  if (!isShared(context)) {
    return { ok: false, status: 400, error: 'Tools are authored in a space, not in personal context.' }
  }
  const folder = await toolFolderIn(context.spaceId, name)
  if (!(await store.readNoteOrNull(context, toolIndexPath(name, folder)))) {
    return { ok: false, status: 404, error: `No tool named "${name}" — create it first.` }
  }

  const path = toolIconPath(name, folder)
  const denial = await writeDenialFull(p, context, path)
  if (denial) return { ok: false, status: 403, error: denial }

  // Removing an icon DELETES its note, so it is held to the same bar as any
  // other note deletion — admin, the note's author, or a full-access grant —
  // rather than to mere write access. Write and delete are different powers
  // everywhere else in the app (app/api/notes/item DELETE, lib/notes/clean.ts);
  // this being the one door where they were the same was the bug.
  const existing = await store.readNoteOrNull(context, path)
  if (existing !== null) {
    const createdBy = await store.getNoteCreatedBy(context, path)
    if (!canRemove(context, createdBy, { principal: p, path })) {
      return {
        ok: false,
        status: 403,
        error: 'Only an admin, the author, or a full-access member can remove this tool’s icon.',
      }
    }
    await store.deleteNote(context, path)
  }

  // Deleting goes around the store's write hook, so the rebuild is explicit —
  // otherwise the build would keep serving the icon that is no longer there.
  return { ok: true, path, build: toBuildSummary(await rebuildTool(context.spaceId, name)) }
}

export type DeleteToolResult = { ok: true } | ToolServiceError

/**
 * Delete a Tool's working copy: its notes (trashed, like any other note), its
 * folder, its `tool:<name>` node, and — through the store's delete hook — its
 * build row.
 *
 * What this deliberately does NOT touch is the registry. A published
 * `AppToolVersion` is immutable and other spaces may run it, so versions
 * survive the working copy the way a released package survives its repo.
 *
 * Held to the same bar as removing any note — admin, the author, or an edit
 * grant at the path (`canRemove`) — on top of write access to the index path.
 * This space's own install goes with it (removeInstallForTool), exactly as it
 * does when the index note is trashed from any note surface instead — the two
 * deletion doors are kept connected by lib/tools/hooks.ts#teardownTool.
 */
export async function deleteTool(
  p: ContextPrincipal,
  context: ResolvedContext,
  name: string,
): Promise<DeleteToolResult> {
  if (!TOOL_NAME_RE.test(name)) return badName(name)
  if (!isShared(context)) {
    return { ok: false, status: 400, error: 'Tools are authored in a space, not in personal context.' }
  }

  const folder = await toolFolderIn(context.spaceId, name)
  const indexPath = toolIndexPath(name, folder)
  if (!(await store.readNoteOrNull(context, indexPath))) {
    return { ok: false, status: 404, error: `No tool named "${name}".` }
  }

  const denial = await writeDenialFull(p, context, indexPath)
  if (denial) return { ok: false, status: 403, error: denial }
  const createdBy = await store.getNoteCreatedBy(context, indexPath)
  if (!canRemove(context, createdBy, { principal: p, path: indexPath })) {
    return {
      ok: false,
      status: 403,
      error: 'Only an admin, the author, or a full-access member can delete this tool.',
    }
  }

  // This space's own install goes with the working copy — the same
  // system-level removal the note-delete hook applies (lib/tools/hooks.ts
  // #teardownTool), so both deletion doors land in the same place. No admin
  // gate beyond canRemove above: a Tool whose author may throw it away must
  // not keep a console entry pointing at it. Other spaces run the published
  // snapshot and keep theirs.
  await removeInstallForTool(context.spaceId, name)

  // The node goes first, while its metadata still points at the index note —
  // that pointer is how removeEntityNode finds it. Links cascade with it.
  await removeEntityNode(context.spaceId, 'tool', indexPath)
  // Then the folder: trashes every note (which drops the build via the store's
  // delete hook), removes the folder rows, and drops grants into the subtree.
  await store.deleteFolder(context, folder)
  return { ok: true }
}

/**
 * A build's diagnostics as plain lines an authoring agent can act on:
 *
 *   index.md the tool frontmatter must include `type: tool`
 *   ui.tsx:12:5 Expected ">" but found "class"
 *
 * Empty string when the build is clean, so a caller can append it to a success
 * message without checking.
 */
export function writeErrorsToPlain(build: BuildSummary): string {
  const lines: string[] = []
  if (build.configError) lines.push(`${INDEX_FILE} ${build.configError}`)
  for (const d of build.errors) lines.push(toolDiagnosticLine(d))
  for (const d of build.warnings) lines.push(`warning: ${toolDiagnosticLine(d)}`)
  return lines.join('\n')
}
