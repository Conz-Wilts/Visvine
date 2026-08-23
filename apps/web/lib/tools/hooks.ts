/**
 * What happens to a Tool's BUILD when its notes change. Called from the note
 * store after every write / rename / delete, beside the agent hooks
 * (lib/agents/hooks.ts) it is modelled on: the notes are authoritative and the
 * `app_tool_builds` row is an index derived from them.
 *
 * Compiling on write is the whole point. An author working over MCP or in the
 * editor gets the compiler's answer on the write that caused it — no build
 * step, no queue, no "it renders blank and I don't know why". So:
 *
 *  • a write anywhere in a Tool's folder rebuilds that Tool;
 *  • a rename that moves a Tool rebuilds the new name and drops the old build
 *    when nothing is left behind;
 *  • deleting the index deletes the build — a Tool without its config note is
 *    not a Tool, and a stale row would keep an install pointing at code its
 *    author has thrown away.
 *
 * Two rules this file never breaks:
 *
 *  1. **It never throws into the write path.** A note save must not fail
 *     because esbuild fell over or the DB blinked; the failure is logged and
 *     the next save re-derives. `rebuildTool` already answers compile ERRORS
 *     with a stored row rather than an exception, so anything caught here is
 *     infrastructure, not the author's code.
 *  2. **It only acts on the SHARED context.** A personal copy of a Tool note is
 *     someone's own draft; it compiles nothing and installs nothing.
 *
 * These hooks are also where the note CHANGE BUS (lib/notes/changes.ts) is
 * fed: they already run after every write/rename/delete in every context, so
 * each one publishes the path first — for personal contexts too, with the
 * ownerKey on the event so a subscriber can filter — before deciding whether
 * the write concerns a Tool build at all.
 *
 * lib/tools/builds.ts is reached by dynamic import, the same discipline
 * agents/hooks.ts uses for the store: the store imports this module, and builds
 * imports the store back.
 */
import { logger } from '@/lib/logger'
import { publishChange } from '@/lib/notes/changes'
import type { Context } from '@/lib/notes/store'
import { isToolPath, toolFileKindOfPath, toolNameOfPath } from './config'

// Redeclared (as agents/hooks.ts and entityLinks.ts do) rather than imported:
// the store imports this module, and a value import back would make an
// eval-time cycle.
const SHARED_OWNER_KEY = 'shared'

function isSharedContext(context: Context): boolean {
  return context.ownerKey === SHARED_OWNER_KEY
}

/** The Tool a path belongs to, or null when the write is none of our business. */
function toolOf(context: Context, path: string): string | null {
  if (!isSharedContext(context) || !isToolPath(path)) return null
  return toolNameOfPath(path)
}

async function rebuild(spaceId: string, name: string): Promise<void> {
  try {
    const builds = await import('./builds')
    await builds.rebuildTool(spaceId, name)
  } catch (err) {
    // Infrastructure, not the author's code — see rule 1 above.
    logger.error('tools.build.failed', { err, spaceId, name })
  }
}

async function dropBuild(spaceId: string, name: string): Promise<void> {
  try {
    const builds = await import('./builds')
    await builds.deleteBuild(spaceId, name)
  } catch (err) {
    logger.error('tools.build.delete.failed', { err, spaceId, name })
  }
}

/**
 * The old name after a rename: drop its build if the folder is now empty (the
 * Tool moved wholesale), otherwise rebuild it — a single source file moved out
 * of a Tool leaves the Tool there, one file poorer, and the author needs to see
 * that as a compile error rather than as a build that silently vanished.
 */
async function settleRenamedFrom(spaceId: string, name: string): Promise<void> {
  try {
    const builds = await import('./builds')
    const sources = await builds.readToolSources(spaceId, name)
    if (sources.index === null && sources.ui === null && sources.data === null) {
      await builds.deleteBuild(spaceId, name)
      return
    }
    await builds.rebuildTool(spaceId, name)
  } catch (err) {
    logger.error('tools.build.rename.failed', { err, spaceId, name })
  }
}

// ── Store hooks ──────────────────────────────────────────────────────────────

/** After a note write (create or save) anywhere under `tools/`. */
export async function toolNoteWritten(context: Context, path: string): Promise<void> {
  publishChange({ spaceId: context.spaceId, ownerKey: context.ownerKey, path, kind: 'write' })
  const name = toolOf(context, path)
  if (!name) return
  await rebuild(context.spaceId, name)
}

/**
 * After a note rename. Either end may name a Tool: a folder rename moves a Tool
 * whole (both ends), a source file moved out of `tools/` leaves only the old
 * one, and one moved in leaves only the new.
 */
export async function toolNoteRenamed(context: Context, from: string, to: string): Promise<void> {
  if (from !== to) publishChange({ spaceId: context.spaceId, ownerKey: context.ownerKey, path: to, kind: 'rename', from })
  if (!isSharedContext(context) || from === to) return
  const fromName = isToolPath(from) ? toolNameOfPath(from) : null
  const toName = isToolPath(to) ? toolNameOfPath(to) : null
  if (fromName && fromName !== toName) await settleRenamedFrom(context.spaceId, fromName)
  if (toName) await rebuild(context.spaceId, toName)
}

/**
 * Losing the index note ends the Tool EVERYWHERE in the space, not just its
 * build. A context note can be trashed from any note surface — the trash menu,
 * a folder delete, an MCP call — and each of those must land in the same place
 * `deleteTool` does: no leftover source notes, no `tool:<name>` node in the
 * graph, and no install row still drawing a console/sidebar entry for a Tool
 * whose author threw it away. Everything here is idempotent, so the explicit
 * `deleteTool` path (which does the same work itself before trashing the
 * notes) rides through as a set of no-ops.
 */
async function teardownTool(context: Context, name: string): Promise<void> {
  try {
    // Dynamic imports, same discipline as `rebuild` above: the store imports
    // this module, and entityNodes/installs both import the store back.
    const [store, entityNodes, installs, config] = await Promise.all([
      import('@/lib/notes/store'),
      import('@/lib/notes/context/entityNodes'),
      import('./installs'),
      import('./config'),
    ])
    // The node first, while its metadata still points at the index note —
    // that pointer is how removeEntityNode finds it. Then the rest of the
    // folder (sources, icon, the folder row itself); trashing the sources
    // re-fires the hooks below, whose rebuilds the final dropBuild sweeps.
    await entityNodes.removeEntityNode(context.spaceId, 'tool', config.toolIndexPath(name))
    await store.deleteFolder(context, config.toolFolderPath(name))
    await installs.removeInstallForTool(context.spaceId, name)
  } catch (err) {
    // Rule 1: never throw into the delete path. The next teardown re-derives.
    logger.error('tools.teardown.failed', { err, spaceId: context.spaceId, name })
  }
}

/** After a note is trashed. Losing the index note ends the Tool. */
export async function toolNoteDeleted(context: Context, path: string): Promise<void> {
  publishChange({ spaceId: context.spaceId, ownerKey: context.ownerKey, path, kind: 'delete' })
  const name = toolOf(context, path)
  if (!name) return
  if (toolFileKindOfPath(path) === 'index') {
    await teardownTool(context, name)
    await dropBuild(context.spaceId, name)
    return
  }
  await rebuild(context.spaceId, name)
}
