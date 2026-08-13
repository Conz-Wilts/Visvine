// Quick capture. A capture appends a dated, attributed line to the caller's private monthly log
// (`log/YYYY-MM.md` in their personal context); a note-bound log appends a dated
// `## Log` entry to an existing note through the gated write path. Captures are
// the raw material the enrichment pass distills into shared insight.

import * as store from './store'
import type { Context } from './store'
import { appendLogGated } from './contextService'
import { formatCaptureEntry } from './shared/noteLog'
import { joinFrontmatter } from './shared/markdown'
import type { ContextPrincipal, WriteResult } from './shared/contextTypes'

function monthlyLogPath(now: number): string {
  const d = new Date(now)
  return `log/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.md`
}

/** Append a capture line to the caller's private monthly log (personal context). */
export async function appendCapture(
  p: ContextPrincipal,
  personalContext: Context,
  text: string,
  refs?: string[],
  tags?: string[],
): Promise<string> {
  const now = Date.now()
  const path = monthlyLogPath(now)
  const line = formatCaptureEntry({ at: now, author: p.name, text, refs, tags })
  let existing: string
  try {
    existing = await store.readNote(personalContext, path)
  } catch {
    existing = joinFrontmatter(
      { type: 'note', title: 'Personal log', author: p.name },
      '# Personal log\n',
    )
  }
  await store.writeNote(
    personalContext,
    path,
    existing.replace(/\s+$/, '') + '\n' + line + '\n',
    { id: p.userId, name: p.name, email: p.email || null },
  )
  return path
}

/** Append a dated `## Log` entry to an existing note (via the gated write path). */
export async function appendNoteBound(
  p: ContextPrincipal,
  context: Context,
  path: string,
  text: string,
): Promise<WriteResult> {
  return appendLogGated(p, context, path, text)
}
