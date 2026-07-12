'use client'

// Roam-style backlinks rendered below the note body, inside the editor's scroll
// column — linked + unlinked references (each with the source title, date, and
// excerpt) plus TF-IDF related notes. Typographic, not boxed: the references read
// as a continuation of the note. Ported in spirit from blackbird-brain.

import { type ReactNode } from 'react'
import type { References, LinkedReference, UnlinkedReference, RelatedNote } from '@/lib/notes/shared/types'

interface Props {
  references: References | null
  related: RelatedNote[] | null
  // The open note's title — highlighted within each excerpt as [[title]].
  title: string
  onOpenNote: (path: string) => void
}

// Wrap whole-word, case-insensitive matches of `needle` in `text` so they render
// as a highlighted [[needle]], mirroring the editor's bracketed note-link style.
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

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
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
  return (
    <div className="notes-ref-block">
      <div className="notes-ref-date-divider">
        <span>{formatDate(refItem.date)}</span>
      </div>
      <div className="notes-ref-head-row">
        <button type="button" className="notes-ref-from" onClick={() => onOpenNote(refItem.fromPath)}>
          {refItem.fromTitle}
        </button>
      </div>
      <p className="notes-ref-excerpt">{highlight(refItem.excerpt, title)}</p>
    </div>
  )
}

export function LinkedReferences({ references, related, title, onOpenNote }: Props) {
  const linked = references?.linked ?? []
  const unlinked = references?.unlinked ?? []
  const rel = related ?? []
  if (linked.length === 0 && unlinked.length === 0 && rel.length === 0) return null

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

      {rel.length > 0 && (
        <section className="notes-ref-group">
          <h3 className="notes-ref-head">
            Related <span className="notes-ref-count">{rel.length}</span>
          </h3>
          <div className="notes-related">
            {rel.map((r) => (
              <button key={r.path} type="button" className="notes-related-item" onClick={() => onOpenNote(r.path)}>
                {r.title}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
