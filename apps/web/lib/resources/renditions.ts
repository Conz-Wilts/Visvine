/**
 * The images derived from a resource: a `thumb` for grids and rows, a
 * `preview` for the viewer when the original is too large or undrawable, a
 * document's `page1`, a video's `poster`. Each is a WebP under
 * `~renditions/` beside no original (objectPaths.ts#resourceRenditionPath),
 * with a row in `resource_renditions`.
 *
 * A rendition is never the file. Every image is re-encoded from its pixels, so
 * EXIF (location, camera, owner) never survives into one — while the ORIGINAL
 * is stored untouched and is what every download serves.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { downloadResourceFile, uploadResourceFile } from '@/lib/gcs'
import { resourceRenditionPath } from '@/lib/storage/objectPaths'

export type RenditionKind = 'thumb' | 'preview' | 'poster' | 'page1'

/** Longest edge of each rendition, in pixels. */
const EDGE: Record<RenditionKind, number> = { thumb: 480, preview: 2048, poster: 1280, page1: 1200 }

/** An image past this many pixels is shown from its preview, never decoded whole in a browser. */
export const MAX_BROWSER_PIXELS = 40_000_000

/**
 * A rendition's bytes: turned upright, fitted inside its edge, re-encoded as
 * WebP from pixels alone — sharp writes no metadata unless asked, so nothing
 * of the source's EXIF survives.
 */
export async function encodeRendition(
  source: Buffer,
  kind: RenditionKind,
): Promise<{ data: Buffer; width: number; height: number }> {
  const sharp = (await import('sharp')).default
  const edge = EDGE[kind]
  const { data, info } = await sharp(source, { limitInputPixels: 268_402_689, failOn: 'none' })
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: kind === 'thumb' ? 78 : 84, effort: 4 })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

async function saveRendition(
  resource: { id: string; spaceId: string },
  kind: RenditionKind,
  source: Buffer,
): Promise<void> {
  const { data, ...info } = await encodeRendition(source, kind)
  const gcsPath = resourceRenditionPath(resource.spaceId, resource.id, kind)
  await uploadResourceFile(gcsPath, data, 'image/webp')
  await prisma.resourceRendition.upsert({
    where: { resourceId_kind: { resourceId: resource.id, kind } },
    create: { resourceId: resource.id, kind, gcsPath, width: info.width, height: info.height, mimeType: 'image/webp' },
    update: { gcsPath, width: info.width, height: info.height, mimeType: 'image/webp' },
  })
}

/** A PDF's first page, drawn — and how many pages it has. */
async function pdfFirstPage(bytes: Buffer): Promise<{ png: Buffer | null; pageCount: number }> {
  const { getDocumentProxy, renderPageAsImage } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  try {
    const pageCount = pdf.numPages
    try {
      const png = await renderPageAsImage(pdf, 1, { canvasImport: () => import('@napi-rs/canvas'), width: EDGE.page1 })
      return { png: Buffer.from(png), pageCount }
    } catch (err) {
      // No canvas in this runtime: the page count and text still stand.
      logger.warn('resources.rendition.pdfCanvas', { err })
      return { png: null, pageCount }
    }
  } finally {
    await pdf.cleanup()
  }
}

/** The picture a presentation carries of its first slide (`docProps/thumbnail.jpeg`). */
async function slidesThumbnail(bytes: Buffer): Promise<Buffer | null> {
  const { unzipSync } = await import('fflate')
  const files = unzipSync(new Uint8Array(bytes), { filter: (file) => file.name === 'docProps/thumbnail.jpeg' })
  const thumb = files['docProps/thumbnail.jpeg']
  return thumb ? Buffer.from(thumb) : null
}

/**
 * Draw every rendition a resource's kind has. Idempotent: a rerun replaces
 * them. Throws on a failure a retry might fix (storage); returns quietly when
 * the file simply has nothing to draw.
 */
export async function renderResource(resourceId: string): Promise<void> {
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, spaceId: true, kind: true, name: true, gcsPath: true, source: true },
  })
  if (!resource?.gcsPath || resource.source !== 'upload') return
  if (!['image', 'pdf', 'slides'].includes(resource.kind)) return

  const bytes = await downloadResourceFile(resource.gcsPath)
  if (resource.kind === 'image') {
    try {
      const sharp = (await import('sharp')).default
      const meta = await sharp(bytes, { failOn: 'none' }).metadata()
      // EXIF orientations 5–8 turn the picture a quarter: its shown size is swapped.
      const turned = (meta.orientation ?? 1) >= 5
      await prisma.resource.update({
        where: { id: resourceId },
        data: turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height },
      })
      await saveRendition(resource, 'thumb', bytes)
      await saveRendition(resource, 'preview', bytes)
    } catch (err) {
      // An image sharp cannot read (HEIC without HEVC, a corrupt file) has no
      // renditions: the grid draws its icon and the viewer offers the file.
      logger.warn('resources.rendition.image', { resourceId, err })
    }
    return
  }
  if (resource.kind === 'pdf') {
    const { png, pageCount } = await pdfFirstPage(bytes)
    await prisma.resource.update({ where: { id: resourceId }, data: { pageCount } })
    if (png) {
      await saveRendition(resource, 'page1', png)
      await saveRendition(resource, 'thumb', png)
    }
    return
  }
  const thumb = await slidesThumbnail(bytes).catch(() => null)
  if (thumb) {
    await saveRendition(resource, 'page1', thumb)
    await saveRendition(resource, 'thumb', thumb)
  }
}

/**
 * A video's poster, sent by the browser that uploaded it: it already decoded
 * the video, and a frame from it costs the server no ffmpeg. Untrusted pixels,
 * so re-encoded like any image; drawn only as that video's thumbnail.
 */
export async function savePoster(resource: { id: string; spaceId: string }, image: Buffer): Promise<void> {
  await saveRendition(resource, 'poster', image)
  await saveRendition(resource, 'thumb', image)
}
