/**
 * The one read behind every resources list — the space's Resources, a
 * channel's Files tab, the pickers, `list_resources`: the visibility rule
 * (`visibility.ts#visibleResourceWhere`) AND the filters, as one indexed
 * query, a page at a time. Search reads a resource's name, its link and
 * unfurl, and the text extracted from it; what it returns is still only
 * what the viewer may see.
 */
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { visibleResourceWhere } from './visibility'
import { viewsOf, VIEW_SELECT } from './views'
import type { ResourceViewer } from './shared/visibility'
import type { ResourceView } from './shared/view'
import type { ListQuery } from './shared/listQuery'
import { filedResourceFolders } from './tree'
import { RESOURCES_ROOT } from './shared/resourceTree'

export interface ResourcePage {
  items: ResourceView[]
  /** The next page's offset, or null at the end. */
  nextOffset: number | null
}

/** Resources whose extracted text mentions `q` (their source paths). */
async function pathsMentioning(spaceId: string, q: string): Promise<string[]> {
  const rows = await prisma.contextSourceChunk.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, text: { contains: q, mode: 'insensitive' } },
    select: { path: true },
    distinct: ['path'],
    take: 200,
  })
  return rows.map((row) => row.path)
}

export async function listResources(
  spaceId: string,
  viewer: ResourceViewer,
  query: ListQuery,
): Promise<ResourcePage> {
  const where: Prisma.ResourceWhereInput[] = [{ spaceId }, visibleResourceWhere(viewer, { trash: query.trash })]
  if (query.folder) {
    // In a folder: what sits in it — or, while searching or filtering, what
    // sits anywhere below it, the way a file browser searches.
    const filed = await filedResourceFolders(spaceId)
    const deep = Boolean(query.q || query.kind !== 'all' || query.channelId || query.by || query.since)
    const inside = (at: string) => (deep ? at === query.folder || at.startsWith(`${query.folder}/`) : at === query.folder)
    if (query.folder === RESOURCES_ROOT) {
      if (!deep) where.push({ OR: [{ nodeId: null }, { nodeId: { notIn: [...filed.keys()] } }] })
    } else {
      where.push({ nodeId: { in: [...filed].filter(([, at]) => inside(at)).map(([id]) => id) } })
    }
  }
  if (query.kind === 'files') where.push({ source: 'upload' })
  else if (query.kind !== 'all') where.push({ kind: query.kind })
  if (query.channelId) where.push({ shares: { some: { conversationId: query.channelId } } })
  if (query.by) where.push({ createdBy: query.by === 'me' ? viewer.userId : query.by })
  if (query.since) where.push({ createdAt: { gte: new Date(query.since) } })
  if (query.q) {
    const paths = await pathsMentioning(spaceId, query.q)
    where.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { url: { contains: query.q, mode: 'insensitive' } },
        { unfurl: { path: ['title'], string_contains: query.q, mode: 'insensitive' } },
        { unfurl: { path: ['description'], string_contains: query.q, mode: 'insensitive' } },
        { unfurl: { path: ['siteName'], string_contains: query.q, mode: 'insensitive' } },
        ...(paths.length ? [{ sourcePath: { in: paths } }] : []),
      ],
    })
  }
  const orderBy: Prisma.ResourceOrderByWithRelationInput[] =
    query.sort === 'name'
      ? [{ name: 'asc' }, { id: 'asc' }]
      : query.sort === 'size'
        ? [{ fileSize: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }]

  const rows = await prisma.resource.findMany({
    where: { AND: where },
    orderBy,
    skip: query.offset,
    take: query.limit + 1,
    select: VIEW_SELECT,
  })
  const more = rows.length > query.limit
  const items = await viewsOf(more ? rows.slice(0, query.limit) : rows, viewer)
  return { items, nextOffset: more ? query.offset + query.limit : null }
}
