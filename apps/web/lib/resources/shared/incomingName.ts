/**
 * The name a file arriving from outside the app is stored under.
 *
 * The Drive decides what a file IS from its extension — an image is re-encoded,
 * a PDF is indexed, anything else is kept as bytes (lib/resources/service.ts).
 * A file uploaded through a browser always has one. A file arriving from an AI
 * chat often does not: a download link ends in an opaque id, base64 has no name
 * at all, and a model will happily call a PNG "logo". So the extension is
 * settled here, before the Drive sees it — from the name if it has a known one,
 * else the declared type, else the bytes' own signature.
 *
 * Pure.
 */

const BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
}

const KNOWN_EXTS = new Set([...Object.values(BY_MIME), '.jpeg', '.tif', '.ico', '.doc', '.xls', '.ppt', '.rtf', '.html', '.htm'])

/** A file's type read from its first bytes, for the formats a person sends most. */
export function sniffExtension(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i]
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return '.png'
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return '.jpg'
  if (bytes.length >= 4 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return '.gif'
  if (bytes.length >= 5 && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return '.pdf'
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) return '.webp'
  return null
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/**
 * A safe base name with a known extension. `name` may be anything a model or a
 * URL supplied: path segments are dropped, control characters stripped, and a
 * missing name becomes `upload`.
 */
export function incomingFileName(
  name: string | null | undefined,
  mimeType: string | null | undefined,
  bytes: Uint8Array,
): string {
  const base = (name ?? '')
    .split(/[/\\]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200) || 'upload'
  if (KNOWN_EXTS.has(extOf(base))) return base
  const ext = BY_MIME[(mimeType ?? '').split(';')[0].trim().toLowerCase()] ?? sniffExtension(bytes)
  return ext ? `${base}${ext}` : base
}

/** The declared type, or the one the settled name implies. */
export function incomingMimeType(fileName: string, mimeType: string | null | undefined): string {
  const declared = (mimeType ?? '').split(';')[0].trim().toLowerCase()
  if (declared && declared !== 'application/octet-stream') return declared
  const ext = extOf(fileName)
  const hit = Object.entries(BY_MIME).find(([, e]) => e === ext || (ext === '.jpeg' && e === '.jpg'))
  return hit?.[0] ?? 'application/octet-stream'
}
