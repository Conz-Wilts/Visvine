// Text extraction for Context Sources. Text-native kinds (csv, markdown, txt,
// json) are a UTF-8 decode; docx and spreadsheets go through the parsers the app
// already ships (mammoth / xlsx), imported lazily so they only load when such a
// file is actually uploaded. This dispatch table is the extension seam for
// further binary kinds (pdf) — add a kind + extractor here and everything
// downstream (chunking, embedding, retrieval, read) is kind-agnostic.

import type { SourceKind } from '../shared/sourceTypes'

const EXTRACTORS: Record<SourceKind, (buffer: Buffer) => string | Promise<string>> = {
  csv: utf8,
  markdown: utf8,
  text: utf8,
  json: utf8,
  docx: fromDocx,
  spreadsheet: fromSpreadsheet,
}

// Postgres text can't store NUL, and a leading BOM would head the first chunk.
const NUL = new RegExp(String.fromCharCode(0), 'g')
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`)

function clean(text: string): string {
  return text.replace(BOM, '').replace(NUL, '')
}

function utf8(buffer: Buffer): string {
  return clean(buffer.toString('utf8'))
}

/** Word document → its raw text (styling, images and footnotes are dropped). */
async function fromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ buffer })
  return clean(value)
}

/**
 * Workbook → one CSV block per sheet under an `## <sheet>` heading. Chunked as
 * prose (not csv): only the first sheet's header row would line up with the CSV
 * chunker's single-header assumption, and the heading keeps each block's origin
 * legible in a retrieved chunk.
 */
async function fromSpreadsheet(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const blocks: string[] = []
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const csv = XLSX.utils.sheet_to_csv(sheet).trim()
    if (csv) blocks.push(`## ${name}\n\n${csv}`)
  }
  return clean(blocks.join('\n\n'))
}

export async function extractText(buffer: Buffer, kind: SourceKind): Promise<string> {
  return EXTRACTORS[kind](buffer)
}
