// Text extraction for Context Sources. v1 kinds are all text-native (csv,
// markdown, txt) so extraction is a UTF-8 decode; this dispatch table is the
// extension seam for binary kinds (pdf, xlsx) — add a kind + extractor here and
// everything downstream (chunking, embedding, retrieval, read) is kind-agnostic.

import type { SourceKind } from '../shared/sourceTypes'

const EXTRACTORS: Record<SourceKind, (buffer: Buffer) => string> = {
  csv: utf8,
  markdown: utf8,
  text: utf8,
}

function utf8(buffer: Buffer): string {
  // Strip a BOM and NUL (Postgres text can't store NUL).
  return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\u0000/g, '')
}

export function extractText(buffer: Buffer, kind: SourceKind): string {
  return EXTRACTORS[kind](buffer)
}
