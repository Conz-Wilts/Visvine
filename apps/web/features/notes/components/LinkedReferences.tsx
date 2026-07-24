'use client'

// Roam-style backlinks rendered below the note body, inside the editor's scroll
// column — linked + unlinked references (each with the source title, date, and
// excerpt). Typographic, not boxed: the references read as a continuation of
// the note. Ported in spirit from blackbird-brain.

import { type ReactNode } from 'react'
import type { References, LinkedReference, UnlinkedReference } from '@/lib/notes/shared/types'
import { formatDate } from '@/lib/date'

interface Props {
  references: References | null
  // The open note's title — highlighted within each excerpt.
  title: string
  onOpenNote: (path: string) => void
}

// Wrap whole-word, case-insensitive matches of `needle` in `text` so they render
// highlighted, mirroring the editor's note-link style.
function highlight(text: string, needle: string): ReactNode[] {
  if (!needle) return [text]
  const re = new RegExp(`(?<![\\w])(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w])`, 'gi')
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    out.push(
      <span key={i++} className="notes-ref-mention">
        {m[0]}
      </span>,
    )
    last = start + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Reference({
  refItem,
  title,
  onOpenNote,
}: {
  refItem: LinkedReference | UnlinkedReference
  title: string
  onOpenNote: (path: string) => void
}) {
  // The block navigates (blackbird-brain behavior): hover draws a box around it,
  // click anywhere opens the source note. The date divider sits above, outside
  // the hover box, so highlighting doesn't swallow the date rule.
  const open = () => onOpenNote(refItem.fromPath)
  return (
    <div className="notes-ref-item">
      <div className="notes-ref-date-divider">
        <span>{formatDate(refItem.date)}</span>
      </div>
      <div
        className="notes-ref-block"
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
      >
        <div className="notes-ref-head-row">
          <button type="button" className="notes-ref-from" onClick={() => onOpenNote(refItem.fromPath)}>
            {refItem.fromTitle}
          </button>
        </div>
        <p className="notes-ref-excerpt">{highlight(refItem.excerpt, title)}</p>
      </div>
    </div>
  )
}

export function LinkedReferences({ references, title, onOpenNote }: Props) {
  // Most recent source note first within each group.
  const linked = [...(references?.linked ?? [])].sort((a, b) => b.date - a.date)
  const unlinked = [...(references?.unlinked ?? [])].sort((a, b) => b.date - a.date)
  if (linked.length === 0 && unlinked.length === 0) return null

  return (
    <div className="notes-references">
      {linked.length > 0 && (
        <section className="notes-ref-group">
          <h3 className="notes-ref-head">
            Linked references <span className="notes-ref-count">{linked.length}</span>
          </h3>
          {linked.map((ref, i) => (
            <Reference key={`l-${i}`} refItem={ref} title={title} onOpenNote={onOpenNote} />
          ))}
        </section>
      )}

      {unlinked.length > 0 && (
        <section className="notes-ref-group">
          <h3 className="notes-ref-head">
            Unlinked references <span className="notes-ref-count">{unlinked.length}</span>
          </h3>
          {unlinked.map((ref, i) => (
            <Reference key={`u-${i}`} refItem={ref} title={title} onOpenNote={onOpenNote} />
          ))}
        </section>
      )}
    </div>
  )
}
