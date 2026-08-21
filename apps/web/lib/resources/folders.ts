/**
 * Drive folders: the tree a space's files are arranged in.
 *
 * Purely organisational. A file indexes, searches and previews the same
 * wherever it sits, so this module touches `folderId` and nothing downstream of
 * it. The root is the absence of a folder — `null` — not a row, which keeps
 * "move to root" a plain NULL write and means a space needs no setup before its
 * first upload.
 */
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'

export interface DriveFolder {
  id: string
  spaceId: string
  name: string
  parentId: string | null
  createdBy: string
  createdAt: string
}

const FOLDER_NAME_MAX = 120

type FolderRow = {
  id: string
  spaceId: string
  name: string
  parentId: string | null
  createdBy: string
  createdAt: Date
}

function toDriveFolder(row: FolderRow): DriveFolder {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

function cleanName(name: string): string {
  const cleaned = name.replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) throw new ApiError(400, 'A folder needs a name')
  return cleaned.slice(0, FOLDER_NAME_MAX)
}

/** Every folder in the space, flat. The tree is small; the client nests it. */
export async function listFolders(spaceId: string): Promise<DriveFolder[]> {
  const rows = await prisma.resourceFolder.findMany({
    where: { spaceId },
    orderBy: { name: 'asc' },
  })
  return rows.map(toDriveFolder)
}

/** A folder that exists and belongs to the space, or a 404. `null` is the root. */
export async function requireFolderInSpace(spaceId: string, folderId: string | null): Promise<void> {
  if (folderId === null) return
  const folder = await prisma.resourceFolder.findUnique({ where: { id: folderId }, select: { spaceId: true } })
  if (!folder || folder.spaceId !== spaceId) throw new ApiError(404, 'Folder not found')
}

export async function createFolder(input: {
  spaceId: string
  name: string
  parentId: string | null
  createdBy: string
}): Promise<DriveFolder> {
  await requireFolderInSpace(input.spaceId, input.parentId)
  const row = await prisma.resourceFolder.create({
    data: {
      spaceId: input.spaceId,
      name: cleanName(input.name),
      parentId: input.parentId,
      createdBy: input.createdBy,
    },
  })
  return toDriveFolder(row)
}

/** The ids of `folderId` and every folder beneath it. */
async function subtreeIds(spaceId: string, folderId: string): Promise<Set<string>> {
  const all = await prisma.resourceFolder.findMany({ where: { spaceId }, select: { id: true, parentId: true } })
  const childrenOf = new Map<string | null, string[]>()
  for (const f of all) {
    const list = childrenOf.get(f.parentId) ?? []
    list.push(f.id)
    childrenOf.set(f.parentId, list)
  }
  const ids = new Set<string>()
  const stack = [folderId]
  while (stack.length) {
    const id = stack.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    stack.push(...(childrenOf.get(id) ?? []))
  }
  return ids
}

/**
 * Rename and/or move a folder. Moving a folder into itself or one of its own
 * descendants would orphan the whole branch, so that is refused rather than
 * written.
 */
export async function updateFolder(
  folderId: string,
  patch: { name?: string; parentId?: string | null },
): Promise<DriveFolder> {
  const existing = await prisma.resourceFolder.findUnique({ where: { id: folderId } })
  if (!existing) throw new ApiError(404, 'Folder not found')

  const data: { name?: string; parentId?: string | null } = {}
  if (patch.name !== undefined) data.name = cleanName(patch.name)
  if (patch.parentId !== undefined) {
    await requireFolderInSpace(existing.spaceId, patch.parentId)
    if (patch.parentId !== null) {
      const descendants = await subtreeIds(existing.spaceId, folderId)
      if (descendants.has(patch.parentId)) throw new ApiError(400, 'A folder cannot be moved inside itself')
    }
    data.parentId = patch.parentId
  }
  const row = await prisma.resourceFolder.update({ where: { id: folderId }, data })
  return toDriveFolder(row)
}

/**
 * Delete a folder. Its subfolders go with it (cascade); the files inside — at
 * any depth — are lifted to the deleted folder's parent. Deleting a folder is
 * never how a file is deleted.
 */
export async function deleteFolder(folderId: string): Promise<void> {
  const existing = await prisma.resourceFolder.findUnique({ where: { id: folderId } })
  if (!existing) throw new ApiError(404, 'Folder not found')
  const ids = await subtreeIds(existing.spaceId, folderId)
  await prisma.$transaction([
    prisma.resource.updateMany({
      where: { spaceId: existing.spaceId, folderId: { in: [...ids] } },
      data: { folderId: existing.parentId },
    }),
    prisma.resourceFolder.delete({ where: { id: folderId } }),
  ])
}

/** Put a file in a folder (`null` for the root). */
export async function moveResource(resourceId: string, folderId: string | null): Promise<void> {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, select: { spaceId: true } })
  if (!resource) throw new ApiError(404, 'Not found')
  await requireFolderInSpace(resource.spaceId, folderId)
  await prisma.resource.update({ where: { id: resourceId }, data: { folderId } })
}

/** Rename a file. The stored object and its index are untouched. */
export async function renameResource(resourceId: string, name: string): Promise<void> {
  const cleaned = name.replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) throw new ApiError(400, 'A file needs a name')
  await prisma.resource.update({ where: { id: resourceId }, data: { name: cleaned.slice(0, 255) } })
}
