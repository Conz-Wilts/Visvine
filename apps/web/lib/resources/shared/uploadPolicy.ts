// What may be uploaded, and whether a file is what it says it is. Pure — the
// upload routes and the MCP's doors ask the same questions.
//
// Three rules:
// 1. Things that run are refused by name: an executable or script is never a
//    resource, whatever it claims to be.
// 2. The bytes must agree with the name. A `.png` whose first bytes are a PDF,
//    or a `.pdf` that is really an executable, is refused — the kind a file is
//    shown as, and the viewer that opens it, come from the name.
// 3. Markup that could run in a browser (HTML, SVG, XML) is stored but never
//    rendered as a document from our origin: SVG only ever through an `<img>`,
//    the rest as text. Every byte is served from the storage origin anyway.

import { kindOf, type ResourceKind } from './kinds'

/** The ceiling for a resumable upload. Env-tunable; fits the row's Int size. */
export const DEFAULT_MAX_UPLOAD_BYTES = 2_000_000_000

const BLOCKED_EXTENSIONS = new Set(
  'exe msi msix dmg pkg app apk aab ipa bat cmd com scr pif cpl ps1 psm1 vbs vbe wsf wsh hta jar sh command run bin reg lnk'.split(' '),
)

/** Mime families a sniffed executable arrives as. */
const EXECUTABLE_MIMES = new Set([
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-executable',
  'application/x-elf',
  'application/x-mach-binary',
  'application/vnd.microsoft.portable-executable',
  'application/x-apple-diskimage',
  'application/vnd.android.package-archive',
  'application/java-archive',
])

function extension(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export type UploadRefusal = string

/** Refuse a file by its name and declared size before a byte is stored. */
export function refuseUploadByName(name: string, size: number, maxBytes: number): UploadRefusal | null {
  if (!name.trim()) return 'A file needs a name'
  if (BLOCKED_EXTENSIONS.has(extension(name))) return `${name} is a program, and programs cannot be uploaded`
  if (!Number.isFinite(size) || size <= 0) return 'The file is empty'
  if (size > maxBytes) return `Files can be at most ${Math.floor(maxBytes / 1_000_000).toLocaleString('en')} MB`
  return null
}

/** The kind a sniffed mime type belongs to, or null when it names no family we know. */
function kindOfMime(mime: string): ResourceKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'application/zip' || mime === 'application/gzip' || mime === 'application/x-tar' || mime === 'application/x-7z-compressed' || mime === 'application/vnd.rar' || mime === 'application/x-bzip2' || mime === 'application/x-xz') {
    return 'archive'
  }
  return kindOf('', mime) === 'other' ? null : kindOf('', mime)
}

/** Office files are zip containers; old ones are OLE compound documents. */
const CONTAINER_KINDS: Record<string, ResourceKind[]> = {
  'application/zip': ['doc', 'sheet', 'slides', 'archive', 'other', 'code'],
  'application/x-cfb': ['doc', 'sheet', 'slides', 'other'],
}

/**
 * Whether the bytes agree with the name. `sniffed` is what the first bytes say
 * (file-type), or null when they carry no signature — plain text, CSV, JSON,
 * code — which agrees with any name whose kind has none either.
 */
export function refuseBySniff(name: string, sniffed: string | null): UploadRefusal | null {
  if (sniffed && EXECUTABLE_MIMES.has(sniffed)) return `${name} is a program, and programs cannot be uploaded`
  if (!sniffed) return null
  const named = kindOf(name)
  const container = CONTAINER_KINDS[sniffed]
  if (container) return container.includes(named) ? null : mismatch(name)
  const bytesSay = kindOfMime(sniffed)
  if (!bytesSay) return null
  if (bytesSay === named) return null
  // A zip-based format the sniffer names more exactly (xlsx, docx, epub…).
  if (named === 'other') return null
  // An audio track in a video container and back again is the same thing.
  if ((named === 'video' && bytesSay === 'audio') || (named === 'audio' && bytesSay === 'video')) return null
  return mismatch(name)
}

function mismatch(name: string): UploadRefusal {
  return `${name} is not what its name says it is`
}

/** Whether a stored file may ever be drawn as a document (never HTML, SVG or XML markup). */
export function isRenderableMarkup(name: string, mime: string | null): boolean {
  const ext = extension(name)
  if (['html', 'htm', 'xhtml', 'svg', 'xml'].includes(ext)) return false
  const type = (mime ?? '').toLowerCase()
  return !(type.includes('html') || type.includes('svg') || type.includes('xml'))
}
