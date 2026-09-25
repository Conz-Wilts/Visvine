/**
 * Which folder of RUNNING configuration a note belongs to, from what the
 * notes declare — the read half of the seal the bridge keeps over
 * configuration (perimeter.ts#refuseRead).
 *
 * The namespaces (`connectors/`, `models/`, `agents/`, `tools/`) are read off
 * the path alone. Configuration filed elsewhere is found by its declaration:
 * a note saying `type: connector` or `type: model` is its own folder's
 * configuration, and a folder whose index says `type: agent` or `type: tool`
 * is configuration all the way down — the brief and the agent's memory, the
 * Tool's index and its sources.
 *
 * Pure over the vault's metas (path + frontmatter), so list, read and search
 * ask it the same way.
 */
import { declaredConfigKind } from '@/lib/notes/shared/configKinds'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { briefFolderOfMeta } from '@/lib/agents/shared/folder'
import { configNamespaceOf } from './perimeter'
import { toolFolderOfIndex } from './config'

export interface NoteMetaLike {
  path: string
  frontmatter: Record<string, unknown>
}

export interface ConfigFolders {
  /** Folders declared as an agent or a Tool: everything under them is configuration. */
  folders: string[]
  /** Notes that declare a connector or a model, with the folder that holds each. */
  notes: Map<string, string>
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

export function configFoldersOf(metas: readonly NoteMetaLike[]): ConfigFolders {
  const folders: string[] = []
  const notes = new Map<string, string>()
  for (const meta of metas) {
    if (configNamespaceOf(meta.path)) continue
    if (declaredConfigKind(meta.frontmatter as NoteFrontmatter)) {
      // A note at the root has no folder to name, so it must be named itself.
      notes.set(meta.path, dirOf(meta.path) || meta.path)
      continue
    }
    const type = typeof meta.frontmatter.type === 'string' ? meta.frontmatter.type.trim().toLowerCase() : ''
    const agent = briefFolderOfMeta(meta.path, meta.frontmatter)
    if (agent) folders.push(agent)
    else if (type === 'tool') {
      const tool = toolFolderOfIndex(meta.path, true)
      if (tool) folders.push(tool)
    }
  }
  // Deepest first, so a note is attributed to the folder nearest it.
  folders.sort((a, b) => b.length - a.length)
  return { folders, notes }
}

/** The configuration folder `path` belongs to by declaration, or null. */
export function configFolderOf(path: string, found: ConfigFolders): string | null {
  const own = found.notes.get(path)
  if (own !== undefined) return own
  return found.folders.find((folder) => path.startsWith(`${folder}/`)) ?? null
}
