/**
 * The Resources file system (lib/resources/shared/resourceTree.ts), read.
 *
 * A folder is an index note under `resources/` that declares no resource; a
 * resource's place is where its note sits — its node's `metadata.notePath`
 * when filed in a folder, the top of `resources/` otherwise. Folders are
 * notes, so which ones a person sees is the note grants' answer.
 */
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { SHARED_OWNER_KEY, readNoteOrNull, renameFolder, type Actor } from '@/lib/notes/store'
import { adoptedNotePath, entityKindOf } from '@/lib/notes/entities'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { principalCanRead } from '@/lib/notes/shared/permissions'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { RESOURCES_ROOT, type ResourceFolderView, folderOfIndex, folderOfResourceNote, parentFolderOfResource } from './shared/resourceTree'

/** The folders directly inside `folder` the principal can read. */
export async function listResourceFolders(
  spaceId: string,
  principal: ContextPrincipal,
  folder: string = RESOURCES_ROOT,
): Promise<ResourceFolderView[]> {
  const depth = folder.split('/').length + 1
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED_OWNER_KEY,
      deletedAt: null,
      path: { startsWith: `${folder}/`, endsWith: '/index.md' },
    },
    select: { path: true, content: true },
  })
  const folders: ResourceFolderView[] = []
  for (const row of rows) {
    const path = folderOfIndex(row.path)
    if (path.split('/').length !== depth) continue
    const fm = parseFrontmatter(row.content)
    if (entityKindOf(String(fm.type ?? '')) === 'resource') continue
    if (!principalCanRead(principal, row.path)) continue
    const name = path.slice(path.lastIndexOf('/') + 1)
    folders.push({
      path,
      title: typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : name,
      description: typeof fm.description === 'string' && fm.description.trim() ? fm.description.trim() : null,
    })
  }
  return folders.sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * The resource nodes filed below the top of `resources/`, each with the
 * folder it sits in. A resource node absent here sits at the top.
 */
export async function filedResourceFolders(spaceId: string): Promise<Map<string, string>> {
  const nodes = await prisma.node.findMany({
    where: { spaceId, type: 'resource', metadata: { path: ['notePath'], string_starts_with: `${RESOURCES_ROOT}/` } },
    select: { id: true, type: true, metadata: true },
  })
  const filed = new Map<string, string>()
  for (const node of nodes) {
    const at = adoptedNotePath({ ...node, metadata: node.metadata as Record<string, unknown> | null })
    if (at) filed.set(node.id, parentFolderOfResource(at))
  }
  return filed
}

/**
 * The folder `named` names — `design`, `resources/design`, `design/logos` — as
 * a path, if its index note exists; `resources` (or nothing) is the top.
 * Throws ApiError(404) for a folder that is not there.
 */
export async function resourceFolderPath(spaceId: string, named: string | null | undefined): Promise<string | null> {
  const bare = named?.trim().replace(/^\/+|\/+$/g, '')
  if (!bare || bare === RESOURCES_ROOT) return null
  const path = bare.startsWith(`${RESOURCES_ROOT}/`) ? bare : `${RESOURCES_ROOT}/${bare}`
  if (path.split('/').some((p) => !p || p === '.' || p === '..')) throw new ApiError(400, `'${named}' is not a folder path`)
  const index = await readNoteOrNull({ spaceId, ownerKey: SHARED_OWNER_KEY }, `${path}/index.md`)
  if (index === null) throw new ApiError(404, `No folder '${path}' — make it with edit_context on ${path}/index.md`)
  return path
}

/**
 * File a resource in `folder` (null for the top of `resources/`): its note
 * folder moves there under its own name, the node's pointer following it
 * (lib/notes/store.ts#renameFolder, entityLinks#repointAdoptedNodes).
 */
export async function fileResource(spaceId: string, nodeId: string, folder: string | null, actor: Actor): Promise<string> {
  const node = await prisma.node.findFirst({ where: { id: nodeId, spaceId }, select: { id: true, type: true, metadata: true } })
  const from = node && folderOfResourceNote({ ...node, metadata: node.metadata as Record<string, unknown> | null })
  if (!from) throw new ApiError(404, 'Resource not found')
  const to = `${folder ?? RESOURCES_ROOT}/${from.slice(from.lastIndexOf('/') + 1)}`
  if (to === from) return from
  return renameFolder({ spaceId, ownerKey: SHARED_OWNER_KEY }, from, to, actor)
}
