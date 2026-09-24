// One resource as every surface reads it — the viewer, the lists, the grid,
// the actions. Pure: `lib/resources/views.ts` loads the rows, this shapes them.
// Every URL here is one of ours and gated (a signed URL is never handed out),
// and the shares listed are only the ones the viewer can see.

import type { SerializedLinkPreview } from '@/lib/messages/types'
import { PROVIDER_LABEL, type LinkProvider } from '@/lib/links/shared/providers'
import { linkCardOf, resourceImagePath, type LinkResourceRow } from './linkCard'
import { resourceRawPath } from './fileNode'

export interface ResourceShareView {
  channelId: string | null
  channelName: string | null
  messageId: string | null
  at: string
  byName: string | null
}

export interface ResourceView {
  id: string
  spaceId: string
  name: string
  kind: string
  source: 'upload' | 'link'
  mimeType: string | null
  fileSize: number | null
  width: number | null
  height: number | null
  pageCount: number | null
  /** The page a link points at. */
  url: string | null
  provider: string | null
  /** `Google Sheets`, `browser` — what the Open action names. */
  providerLabel: string
  /** An embed we built for an allowlisted provider, or null. */
  embedUrl: string | null
  card: SerializedLinkPreview | null
  /** The original's bytes, for drawing. */
  rawUrl: string | null
  /** The original, as a download under its own name. */
  downloadUrl: string | null
  thumbUrl: string | null
  previewUrl: string | null
  page1Url: string | null
  posterUrl: string | null
  createdAt: string
  creator: { id: string; name: string; image: string | null } | null
  shares: ResourceShareView[]
  sharedToSpace: boolean
  nodeId: string | null
  canManage: boolean
  deleted: boolean
  indexState: string
  /** Text was extracted and can be read (`read_resource`, the slides outline). */
  hasText: boolean
}

export interface ResourceViewRow extends LinkResourceRow {
  spaceId: string
  kind: string
  source: string
  mimeType: string | null
  fileSize: number | null
  width: number | null
  height: number | null
  pageCount: number | null
  gcsPath: string | null
  createdAt: Date
  deletedAt: Date | null
  nodeId: string | null
  indexState: string
  sourcePath: string | null
  renditions: ReadonlyArray<{ kind: string }>
}

export function toResourceView(
  row: ResourceViewRow,
  extra: {
    creator: ResourceView['creator']
    shares: ResourceShareView[]
    sharedToSpace: boolean
    canManage: boolean
  },
): ResourceView {
  const kinds = new Set(row.renditions.map((r) => r.kind))
  const link = row.source === 'link'
  const card = link ? linkCardOf(row) : null
  const provider = (row.provider ?? (link ? 'web' : null)) as LinkProvider | null
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    kind: row.kind,
    source: link ? 'link' : 'upload',
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    pageCount: row.pageCount,
    url: row.url,
    provider,
    providerLabel: provider ? PROVIDER_LABEL[provider] ?? 'browser' : 'browser',
    embedUrl: row.embedUrl,
    card,
    rawUrl: row.gcsPath ? resourceRawPath(row.id) : null,
    downloadUrl: row.gcsPath ? `${resourceRawPath(row.id)}?download=1` : null,
    thumbUrl: kinds.has('thumb') || (link && row.previewPath) ? resourceImagePath(row.id, 'thumb') : null,
    previewUrl: kinds.has('preview') ? resourceImagePath(row.id, 'preview') : null,
    page1Url: kinds.has('page1') ? resourceImagePath(row.id, 'page1') : null,
    posterUrl: kinds.has('poster') ? resourceImagePath(row.id, 'poster') : null,
    createdAt: row.createdAt.toISOString(),
    creator: extra.creator,
    shares: extra.shares,
    sharedToSpace: extra.sharedToSpace,
    nodeId: row.nodeId,
    canManage: extra.canManage,
    deleted: row.deletedAt !== null,
    indexState: row.indexState,
    hasText: row.indexState === 'indexed' && row.sourcePath !== null,
  }
}
