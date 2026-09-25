/**
 * A resource's own facts that a person edits in place.
 */
import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'

/** Rename a file. The stored object and its index are untouched. */
export async function renameResource(resourceId: string, name: string): Promise<void> {
  const cleaned = name.replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) throw new ApiError(400, 'A file needs a name')
  await prisma.resource.update({ where: { id: resourceId }, data: { name: cleaned.slice(0, 255) } })
}
