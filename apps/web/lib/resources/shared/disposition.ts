// The Content-Disposition a download carries. Pure.
//
// A filename rides twice: an ASCII fallback in `filename=` for old clients and
// the exact name, percent-encoded, in `filename*=` (RFC 6266 / 5987), so
// "Q3 résumé.pdf" downloads as itself and a quote or a newline can never break
// out of the header.

export function contentDisposition(filename: string, mode: 'attachment' | 'inline' = 'attachment'): string {
  const clean = filename.replace(/[\r\n]/g, ' ').trim() || 'file'
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
