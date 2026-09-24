// How a link resource is drawn as a card under a message, in the viewer, in a
// grid. Pure — the message serializer and the resources read both use it, so
// a card looks the same wherever it is. Every image is ours (the unfurl job
// re-hosted it): the page's own image URL is never handed to a browser.

import type { SerializedLinkPreview } from '@/lib/messages/types'
import { hostOf } from '@/lib/links/shared/unfurl'

export interface LinkResourceRow {
  id: string
  name: string
  url: string | null
  provider: string | null
  embedUrl: string | null
  unfurl: unknown
  previewPath: string | null
  fetchState: string | null
  renditions?: ReadonlyArray<{ kind: string }>
}

export interface StoredUnfurl {
  title?: string | null
  description?: string | null
  siteName?: string | null
  authorName?: string | null
  publishedAt?: string | null
  mediaType?: string | null
  imageLayout?: 'summary' | 'large' | null
}

function storedUnfurl(value: unknown): StoredUnfurl {
  return value && typeof value === 'object' ? (value as StoredUnfurl) : {}
}

/** A resource's own image, by rendition kind — the gated `/thumb` route. */
export function resourceImagePath(resourceId: string, kind: 'thumb' | 'preview' | 'favicon' | 'poster' | 'page1'): string {
  return `/api/resources/${encodeURIComponent(resourceId)}/thumb?kind=${kind}`
}

export function linkCardOf(row: LinkResourceRow): SerializedLinkPreview {
  const unfurl = storedUnfurl(row.unfurl)
  const url = row.url ?? ''
  const kinds = new Set((row.renditions ?? []).map((r) => r.kind))
  const hasImage = !!row.previewPath || kinds.has('preview')
  return {
    resourceId: row.id,
    url,
    title: unfurl.title ?? (row.name && row.name !== hostOf(url) ? row.name : null),
    description: unfurl.description ?? null,
    imageUrl: hasImage ? resourceImagePath(row.id, 'preview') : null,
    siteName: unfurl.siteName ?? hostOf(url),
    faviconUrl: kinds.has('favicon') ? resourceImagePath(row.id, 'favicon') : null,
    mediaType: unfurl.mediaType ?? null,
    imageLayout: hasImage ? (unfurl.imageLayout ?? 'large') : null,
    authorName: unfurl.authorName ?? null,
    publishedAt: unfurl.publishedAt ?? null,
    provider: row.provider ?? 'web',
    embedUrl: row.embedUrl,
    pending: row.fetchState === 'pending',
  }
}
