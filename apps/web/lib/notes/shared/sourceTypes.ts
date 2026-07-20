// Types for Context Sources — non-note files/tables attached to a brain that
// feed the fused retrieval but never become graph Nodes. A source is addressed
// by the same brain-relative POSIX `path` as a note (so the folder gate and
// visibility lens govern it unchanged), but never with a `.md` extension — the
// note namespace stays disjoint. Pure — no Node/DOM/Prisma imports.

/** File kinds the extractor understands. PDF/XLSX are the documented extension point. */
export type SourceKind = 'csv' | 'markdown' | 'text'

export type SourceStatus = 'pending' | 'ready' | 'failed'

/** The metadata shape the routes and UI exchange (no content, no GCS internals). */
export interface ContextSourceMeta {
  id: string
  path: string // brain-relative POSIX path incl. filename, e.g. "deals/pricing.csv"
  name: string // display filename
  kind: SourceKind
  mimeType: string
  sizeBytes: number
  status: SourceStatus
  error?: string
  /** Extraction hit the text/chunk caps — search covers only the indexed head. */
  truncated: boolean
  textChars?: number
  chunkCount: number
  createdBy: string
  mtime: number // updatedAt epoch ms
}

/** Extensions accepted per kind — the upload/extract dispatch table. */
export const SOURCE_EXTENSIONS: Record<string, SourceKind> = {
  csv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
}

/** Detect a source kind from a filename, or null when unsupported. */
export function sourceKindOf(filename: string): SourceKind | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return SOURCE_EXTENSIONS[ext] ?? null
}

/**
 * The `.md` extension is the note namespace — an uploaded markdown file is
 * stored under `.markdown` so a source path can never collide with a note path.
 */
export function normalizeSourcePath(path: string): string {
  return path.replace(/\.md$/i, '.markdown')
}
