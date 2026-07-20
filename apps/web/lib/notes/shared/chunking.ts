// Pure chunkers for Context Source ingestion. A source can be far larger than a
// note, so retrieval works over chunks: prose splits on paragraph boundaries
// with a small overlap; CSV packs rows with the header context repeated so each
// chunk is self-describing for embedding. Caps bound the in-request ingestion
// cost (serverless: extract + embed run inside the upload request).

import { parseCsvRows } from '@/lib/crm/csv'
import type { SourceKind } from './sourceTypes'

/** Extracted text beyond this is dropped (the head is still indexed). */
export const MAX_TEXT_CHARS = 500_000
/** Chunks beyond this are dropped — bounds embedding cost (≤5 batched calls). */
export const MAX_CHUNKS = 300
/** Target prose chunk size; paragraphs pack up to this. */
export const CHUNK_CHARS = 1500
/** Tail of the previous prose chunk carried into the next for continuity. */
export const CHUNK_OVERLAP = 150
/** Data rows per CSV chunk (plus the repeated header line). */
export const CSV_ROWS_PER_CHUNK = 20

export interface ChunkingResult {
  chunks: string[]
  /** True when MAX_TEXT_CHARS or MAX_CHUNKS dropped content. */
  truncated: boolean
  /** Length of the extracted text considered (pre-chunk, post text-cap). */
  textChars: number
}

/** Split prose on blank-line paragraph boundaries, hard-splitting giant paragraphs. */
function paragraphs(text: string): string[] {
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    if (p.length <= CHUNK_CHARS) {
      out.push(p)
    } else {
      for (let i = 0; i < p.length; i += CHUNK_CHARS) out.push(p.slice(i, i + CHUNK_CHARS))
    }
  }
  return out
}

function chunkProse(text: string): string[] {
  const chunks: string[] = []
  let current = ''
  for (const p of paragraphs(text)) {
    if (current && current.length + p.length + 2 > CHUNK_CHARS) {
      chunks.push(current)
      // Carry a short tail forward so a thought split across chunks stays findable.
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current.trim()) chunks.push(current)
  return chunks
}

/** Serialize CSV rows as `col: value` lines, header context repeated per chunk. */
function chunkCsv(text: string): string[] {
  const { headers, rows } = parseCsvRows(text)
  if (!headers.length) return chunkProse(text) // headerless/degenerate — treat as prose
  const headerLine = `Columns: ${headers.join(', ')}`
  const chunks: string[] = []
  for (let i = 0; i < rows.length; i += CSV_ROWS_PER_CHUNK) {
    const rowLines = rows.slice(i, i + CSV_ROWS_PER_CHUNK).map((row) =>
      headers
        .map((h) => (row[h] ? `${h}: ${row[h]}` : null))
        .filter(Boolean)
        .join('; '),
    )
    chunks.push([headerLine, ...rowLines].join('\n'))
  }
  return chunks
}

/** Chunk extracted source text by kind, applying the text and chunk-count caps. */
export function chunkSourceText(text: string, kind: SourceKind): ChunkingResult {
  let truncated = false
  let capped = text
  if (capped.length > MAX_TEXT_CHARS) {
    capped = capped.slice(0, MAX_TEXT_CHARS)
    truncated = true
  }
  const all = kind === 'csv' ? chunkCsv(capped) : chunkProse(capped)
  const chunks = all.slice(0, MAX_CHUNKS)
  if (all.length > MAX_CHUNKS) truncated = true
  return { chunks, truncated, textChars: capped.length }
}
