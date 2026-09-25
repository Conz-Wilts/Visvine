/**
 * Just enough of a source-map reader to point a finding at the line an author
 * wrote. Pure.
 *
 * The security rules read `ui.tsx` AFTER esbuild has stripped its types and
 * turned its JSX into calls, because that is the one shape a JavaScript parser
 * reads and the one where `<input type="password">` and `jsx("input", …)` are
 * the same thing. The finding must still name the source line, so the map
 * esbuild writes alongside is decoded here: base64 VLQ, v3, one source.
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DIGIT = new Map([...BASE64].map((ch, i) => [ch, i]))

/** Decode one segment's VLQ fields. */
function decodeSegment(segment: string): number[] {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const ch of segment) {
    const digit = DIGIT.get(ch)
    if (digit === undefined) return values
    value += (digit & 31) << shift
    if (digit & 32) {
      shift += 5
      continue
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  return values
}

interface Mapping {
  genColumn: number
  line: number
  column: number
}

export type PositionLookup = (line: number, column: number) => { line: number; column: number } | null

/**
 * A lookup from a generated position (1-based line, 0-based column) to the
 * original one, or a lookup that answers null for every position when the map
 * cannot be read — a finding without a line is still a finding.
 */
export function positionLookup(mapJson: string | null | undefined): PositionLookup {
  let mappings: string
  try {
    const parsed = JSON.parse(mapJson ?? '') as { mappings?: unknown }
    if (typeof parsed.mappings !== 'string') return () => null
    mappings = parsed.mappings
  } catch {
    return () => null
  }

  const lines: Mapping[][] = []
  let srcLine = 0
  let srcColumn = 0
  for (const lineText of mappings.split(';')) {
    const row: Mapping[] = []
    let genColumn = 0
    for (const segment of lineText.split(',')) {
      if (!segment) continue
      const fields = decodeSegment(segment)
      if (fields.length === 0) continue
      genColumn += fields[0]
      if (fields.length < 4) continue
      srcLine += fields[2]
      srcColumn += fields[3]
      row.push({ genColumn, line: srcLine, column: srcColumn })
    }
    lines.push(row)
  }

  return (line, column) => {
    for (let at = line - 1; at >= 0; at--) {
      const row = lines[at]
      if (!row || row.length === 0) continue
      if (at === line - 1) {
        let best: Mapping | null = null
        for (const m of row) {
          if (m.genColumn <= column) best = m
          else break
        }
        const hit = best ?? row[0]
        return { line: hit.line + 1, column: hit.column }
      }
      const last = row[row.length - 1]
      return { line: last.line + 1, column: last.column }
    }
    return null
  }
}
