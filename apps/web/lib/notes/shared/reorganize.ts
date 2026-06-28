// Pure validation for the agentic reorganize workflow. Kept here (free of Node/
// Electron imports) so it can be unit-tested and reused by the main process.

import type { MoveProposal } from './types'

// Keep only moves the model could legitimately make: a real source path, a safe
// .md destination, no self-moves, and no collisions with existing notes or with
// another accepted move. This is the guard that stops a hallucinated or unsafe
// path from ever reaching the filesystem.
export function coerceMoves(raw: unknown, existing: Set<string>): MoveProposal[] {
  if (!Array.isArray(raw)) return []
  const out: MoveProposal[] = []
  const targets = new Set<string>()
  for (const m of raw) {
    if (!m || typeof m.from !== 'string' || typeof m.to !== 'string') continue
    const from = m.from.trim()
    const to = m.to.trim().replace(/^\/+/, '')
    if (!existing.has(from)) continue
    if (!to.toLowerCase().endsWith('.md')) continue
    if (to.includes('..')) continue
    if (to === from) continue
    if (existing.has(to) || targets.has(to)) continue
    targets.add(to)
    out.push({ from, to, reason: typeof m.reason === 'string' ? m.reason : '' })
  }
  return out
}
