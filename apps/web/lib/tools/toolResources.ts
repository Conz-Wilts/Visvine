/**
 * Files and links as a Tool reads them: a trimmed view, and the bytes of one
 * as a data URL the frame can draw (`img-src data:` is the frame's CSP).
 * Nothing here decides who may see a resource — the bridge asks
 * `requireVisibleResource` and the Tool's `permissions.resources` first — and
 * nothing here hands out a URL: a signed URL is a bearer capability, and the
 * frame has no session to use the gated ones with.
 */
import prisma from '@/lib/prisma'
import { downloadResourceFile } from '@/lib/gcs'
import type { ResourceView } from '@/lib/resources/shared/view'
import type { ToolResource } from './protocol'

export function toToolResource(view: ResourceView): ToolResource {
  return {
    id: view.id,
    name: view.name,
    kind: view.kind,
    source: view.source,
    mimeType: view.mimeType,
    fileSize: view.fileSize,
    url: view.url,
    notePath: view.notePath,
    hasText: view.hasText,
    createdAt: view.createdAt,
  }
}

export type BlobRendition = 'original' | 'thumb' | 'preview'

export type BlobResult =
  | { ok: true; mimeType: string; dataUrl: string }
  | { ok: false; reason: 'none' | 'too_large'; bytes?: number }

/**
 * One resource's bytes — the original, or an image made from it — as a data
 * URL, when there are any and they fit. The caller has already gated the
 * resource; this reads the row it names and nothing else.
 */
export async function resourceBlob(resourceId: string, rendition: BlobRendition, maxBytes: number): Promise<BlobResult> {
  if (rendition === 'original') {
    const row = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: { gcsPath: true, mimeType: true, fileSize: true },
    })
    if (!row?.gcsPath) return { ok: false, reason: 'none' }
    if (row.fileSize !== null && row.fileSize > maxBytes) return { ok: false, reason: 'too_large', bytes: row.fileSize }
    const bytes = await downloadResourceFile(row.gcsPath)
    if (bytes.length > maxBytes) return { ok: false, reason: 'too_large', bytes: bytes.length }
    const mimeType = row.mimeType ?? 'application/octet-stream'
    return { ok: true, mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` }
  }
  const made = await prisma.resourceRendition.findUnique({
    where: { resourceId_kind: { resourceId, kind: rendition } },
    select: { gcsPath: true, mimeType: true },
  })
  // A link's page image, re-hosted by the unfurler, stands in for its thumb.
  const fallback = made
    ? null
    : await prisma.resource.findUnique({ where: { id: resourceId }, select: { previewPath: true } })
  const path = made?.gcsPath ?? fallback?.previewPath ?? null
  if (!path) return { ok: false, reason: 'none' }
  const bytes = await downloadResourceFile(path)
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_large', bytes: bytes.length }
  const mimeType = made?.mimeType ?? 'image/webp'
  return { ok: true, mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` }
}
