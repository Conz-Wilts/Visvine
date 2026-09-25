// Where a space's Tools ARE.
//
// A Tool is the folder whose index declares `type: tool` — `tools/<name>/`,
// where a new one lands, or a folder of the space's own
// (lib/tools/config.ts#toolFolderDenial). Its build, installs and versions
// key on the NAME, so nothing may find a Tool's notes by building their path:
// every read by name comes here, and so does every "is this path inside a
// Tool?" question the hooks and the gates ask.

import prisma from '@/lib/prisma'
import {
  declaresTool,
  TOOLS_DIR,
  toolFileKindIn,
  toolFolderDenial,
  toolFolderOfIndex,
  toolFolderPath,
  toolNameOfFolder,
} from './config'

const SHARED_OWNER_KEY = 'shared'
const INDEX = 'index.md'

/** The Tool a path sits in, and what the path is there. */
export interface ToolAt {
  name: string
  folder: string
  kind: 'index' | 'ui' | 'data' | 'icon' | 'other'
}

/**
 * The folder of the Tool `name` in `spaceId`: `tools/<name>` when its index is
 * there, else the folder named `name` whose index declares `type: tool`, else
 * `tools/<name>` — where a Tool that does not exist yet would be written.
 */
export async function toolFolderIn(spaceId: string, name: string, ownerKey: string = SHARED_OWNER_KEY): Promise<string> {
  const home = toolFolderPath(name)
  const atHome = await prisma.contextNote.findFirst({
    where: { spaceId, ownerKey, deletedAt: null, path: `${home}/${INDEX}` },
    select: { id: true },
  })
  if (atHome) return home
  const rows = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey, deletedAt: null, path: { endsWith: `/${name}/${INDEX}` }, content: { contains: 'tool', mode: 'insensitive' } },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  for (const row of rows) {
    const folder = toolFolderOfIndex(row.path, declaresTool(row.content))
    if (folder && toolNameOfFolder(folder) === name) return folder
  }
  return home
}

/** Every folder above `path`, nearest first. */
function ancestors(path: string): string[] {
  const out: string[] = []
  let cut = path.lastIndexOf('/')
  while (cut > 0) {
    out.push(path.slice(0, cut))
    cut = path.lastIndexOf('/', cut - 1)
  }
  return out
}

/**
 * The Tool whose folder `path` is inside, or null. Under `tools/` the path
 * decides; elsewhere the nearest folder whose index declares `type: tool`.
 * `deleted` also counts a just-trashed index, for the delete hook.
 */
export async function toolContaining(
  spaceId: string,
  path: string,
  opts: { ownerKey?: string; deleted?: boolean } = {},
): Promise<ToolAt | null> {
  const clean = path.replace(/^\/+/, '')
  const home = /^tools\/([^/]+)\//.exec(clean)
  if (home) {
    const folder = toolFolderPath(home[1])
    if (toolFolderDenial(folder)) return null
    return { name: home[1], folder, kind: toolFileKindIn(folder, clean) ?? 'other' }
  }
  if (clean === TOOLS_DIR || clean.startsWith(`${TOOLS_DIR}/`)) return null
  const folders = ancestors(clean).filter((f) => !toolFolderDenial(f))
  if (folders.length === 0) return null
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: opts.ownerKey ?? SHARED_OWNER_KEY,
      ...(opts.deleted ? {} : { deletedAt: null }),
      path: { in: folders.map((f) => `${f}/${INDEX}`) },
      content: { contains: 'tool', mode: 'insensitive' },
    },
    select: { path: true, content: true },
  })
  const tools = new Set(rows.filter((r) => declaresTool(r.content)).map((r) => r.path.slice(0, -(INDEX.length + 1))))
  const folder = folders.find((f) => tools.has(f))
  if (!folder) return null
  return { name: toolNameOfFolder(folder), folder, kind: toolFileKindIn(folder, clean) ?? 'other' }
}

/** Every Tool folder in a context, keyed by name; `tools/<name>` wins its name. */
export async function toolFolders(spaceId: string, ownerKey: string = SHARED_OWNER_KEY): Promise<Map<string, string>> {
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey,
      deletedAt: null,
      OR: [
        { path: { startsWith: `${TOOLS_DIR}/`, endsWith: `/${INDEX}` } },
        { path: { endsWith: `/${INDEX}` }, content: { contains: 'tool', mode: 'insensitive' } },
      ],
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  const out = new Map<string, string>()
  for (const row of rows) {
    const folder = toolFolderOfIndex(row.path, declaresTool(row.content))
    if (!folder) continue
    const name = toolNameOfFolder(folder)
    if (out.get(name) === toolFolderPath(name)) continue
    out.set(name, folder)
  }
  return out
}
