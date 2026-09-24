// Text extraction for Context Sources. Text-native kinds (csv, markdown, txt,
// json) are a UTF-8 decode; docx, spreadsheets, PDFs and slide decks go through
// parsers imported lazily (mammoth, xlsx, unpdf, fflate), so each only loads
// when such a file is actually uploaded. This dispatch table is the extension
// seam — add a kind + extractor here and everything downstream (chunking,
// embedding, retrieval, read) is kind-agnostic.

import type { SourceKind } from '../shared/sourceTypes'

const EXTRACTORS: Record<SourceKind, (buffer: Buffer) => string | Promise<string>> = {
  csv: utf8,
  markdown: utf8,
  text: utf8,
  json: utf8,
  docx: fromDocx,
  spreadsheet: fromSpreadsheet,
  pdf: fromPdf,
  slides: fromSlides,
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

/** PDF → its text, one `## Page n` block per page so a chunk says where it came from. */
async function fromPdf(buffer: Buffer): Promise<string> {
  const { extractText: pdfText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  try {
    const { text } = await pdfText(pdf, { mergePages: false })
    const pages = (Array.isArray(text) ? text : [text]).map((page, i) => `## Page ${i + 1}\n\n${page.trim()}`)
    return clean(pages.filter((page) => !page.endsWith('\n\n')).join('\n\n'))
  } finally {
    await pdf.cleanup()
  }
}

/** A .pptx deck → its slides' text, in order, one `## Slide n` block each. */
async function fromSlides(buffer: Buffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const files = unzipSync(new Uint8Array(buffer), { filter: (file) => /^ppt\/slides\/slide\d+\.xml$/.test(file.name) })
  const slides = Object.entries(files)
    .map(([name, bytes]) => ({ n: Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0), xml: strFromU8(bytes) }))
    .sort((a, b) => a.n - b.n)
  const blocks = slides.map(({ n, xml }) => {
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]))
    return runs.length ? `## Slide ${n}\n\n${runs.join(' ')}` : ''
  })
  return clean(blocks.filter(Boolean).join('\n\n'))
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export async function extractText(buffer: Buffer, kind: SourceKind): Promise<string> {
  return EXTRACTORS[kind](buffer)
}
