// What a resource IS, from its name and type. Pure — the upload path, the
// viewer registry, the filters and the actions all read the same answer.
//
// `kind` is the family the viewer and the filter chips key on; `fileType` is
// the older display bucket (pdf, docx, xlsx…) still written beside it.

export const RESOURCE_KINDS = [
  'image',
  'video',
  'audio',
  'pdf',
  'doc',
  'sheet',
  'slides',
  'text',
  'code',
  'archive',
  'link',
  'other',
] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]


const BY_EXT: Record<string, ResourceKind> = {}
function family(kind: ResourceKind, exts: string) {
  for (const ext of exts.split(' ')) BY_EXT[ext] = kind
}
family('image', 'jpg jpeg png gif webp avif bmp tif tiff heic heif ico svg')
family('video', 'mp4 m4v mov webm mkv avi ogv')
family('audio', 'mp3 wav m4a aac ogg oga flac opus')
family('pdf', 'pdf')
family('doc', 'docx doc odt rtf pages')
family('sheet', 'xlsx xls xlsm csv tsv ods numbers')
family('slides', 'pptx ppt odp key')
family('text', 'txt md markdown log')
family(
  'code',
  'json js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp hpp cs php sh sql yaml yml toml xml html htm css scss ini env',
)
family('archive', 'zip gz tgz tar rar 7z bz2 xz')

const BY_MIME_PREFIX: Array<[string, ResourceKind]> = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['application/pdf', 'pdf'],
  ['text/csv', 'sheet'],
  ['text/markdown', 'text'],
  ['text/plain', 'text'],
  ['application/json', 'code'],
  ['application/zip', 'archive'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml', 'doc'],
  ['application/msword', 'doc'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml', 'sheet'],
  ['application/vnd.ms-excel', 'sheet'],
  ['application/vnd.openxmlformats-officedocument.presentationml', 'slides'],
  ['application/vnd.ms-powerpoint', 'slides'],
]

/** The lowercase extension of a file name, without the dot ('' when none). */
function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** A file's kind: its extension first (what the person named it), then its type. */
export function kindOf(name: string, mimeType?: string | null): ResourceKind {
  const byExt = BY_EXT[extensionOf(name)]
  if (byExt) return byExt
  const mime = (mimeType ?? '').toLowerCase()
  for (const [prefix, kind] of BY_MIME_PREFIX) if (mime.startsWith(prefix)) return kind
  return 'other'
}

/** The older display bucket, kept beside `kind` for the readers that key on it. */
export function fileTypeOf(name: string, mimeType?: string | null): string {
  const ext = extensionOf(name)
  const kind = kindOf(name, mimeType)
  if (kind === 'image') return 'image'
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (ext === 'csv') return 'csv'
  if (ext === 'docx' || ext === 'doc') return 'docx'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'json') return 'json'
  if (ext === 'txt') return 'text'
  return ext || 'file'
}
