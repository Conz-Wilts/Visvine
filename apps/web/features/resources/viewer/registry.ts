// Which renderer draws a resource. Pure — the viewer asks it, a test pins it.
// Keyed by kind, then narrowed by what a browser can actually draw: a .mov
// plays, a .mkv does not; a .docx renders, a .doc does not; a 3 MB log is
// offered as a download rather than frozen into a <pre>.

import { isRenderableMarkup } from '@/lib/resources/shared/uploadPolicy'

export type RendererKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'docx'
  | 'sheet'
  | 'slides'
  | 'markdown'
  | 'text'
  | 'link-embed'
  | 'link-card'
  | 'unsupported'

export interface RenderableResource {
  kind: string
  source: 'upload' | 'link'
  name: string
  mimeType: string | null
  fileSize: number | null
  width: number | null
  height: number | null
  embedUrl: string | null
  rawUrl: string | null
  previewUrl: string | null
  page1Url: string | null
  hasText: boolean
}

/** Text drawn in the viewer is capped: past this it is a download. */
const MAX_TEXT_BYTES = 1_000_000

/** An image past this many pixels is drawn from its preview. */
const MAX_BROWSER_PIXELS = 40_000_000

const PLAYABLE_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv'])
const PLAYABLE_AUDIO = new Set(['mp3', 'wav', 'm4a', 'aac', 'oga', 'ogg', 'flac', 'opus'])
const BROWSER_IMAGES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'])
const SHEETS = new Set(['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'ods'])

function ext(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function rendererFor(r: RenderableResource): RendererKind {
  if (r.source === 'link') return r.embedUrl ? 'link-embed' : 'link-card'
  if (!r.rawUrl) return 'unsupported'
  const e = ext(r.name)
  const small = (r.fileSize ?? 0) <= MAX_TEXT_BYTES
  switch (r.kind) {
    case 'image':
      return BROWSER_IMAGES.has(e) || r.previewUrl ? 'image' : 'unsupported'
    case 'video':
      return PLAYABLE_VIDEO.has(e) ? 'video' : 'unsupported'
    case 'audio':
      return PLAYABLE_AUDIO.has(e) ? 'audio' : 'unsupported'
    case 'pdf':
      return 'pdf'
    case 'doc':
      return e === 'docx' ? 'docx' : 'unsupported'
    case 'sheet':
      return SHEETS.has(e) ? 'sheet' : 'unsupported'
    case 'slides':
      return r.page1Url || r.hasText ? 'slides' : 'unsupported'
    case 'text':
      if (!small) return 'unsupported'
      return e === 'md' || e === 'markdown' ? 'markdown' : 'text'
    case 'code':
      // Markup is shown as its source, never rendered (uploadPolicy.ts).
      return small ? 'text' : 'unsupported'
    default:
      return 'unsupported'
  }
}

/**
 * The address an image is DRAWN from. The original wherever a browser can
 * decode it — so "Save image" saves the original, never a rendition (the
 * Mattermost bug) — and the preview only for what it cannot (HEIC, TIFF) or
 * should not decode whole (past 40 MP).
 */
export function imageSourceOf(r: RenderableResource): { src: string; isOriginal: boolean } | null {
  const pixels = (r.width ?? 0) * (r.height ?? 0)
  const decodable = BROWSER_IMAGES.has(ext(r.name)) && pixels <= MAX_BROWSER_PIXELS
  if (decodable && r.rawUrl) return { src: r.rawUrl, isOriginal: true }
  if (r.previewUrl) return { src: r.previewUrl, isOriginal: false }
  return r.rawUrl ? { src: r.rawUrl, isOriginal: true } : null
}

/** Whether a text file's name says it is markup that must be shown as source. */
export function showAsSource(r: Pick<RenderableResource, 'name' | 'mimeType'>): boolean {
  return !isRenderableMarkup(r.name, r.mimeType)
}
