'use client'

// Roam-style backlinks rendered below the note body, inside the editor's scroll
// column — linked + unlinked references (each with the source title, date, and
// excerpt). Typographic, not boxed: the references read as a continuation of
// the note. Ported in spirit from blackbird-brain.

import { useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import type {
  References,
  LinkedReference,
  UnlinkedReference,
  RestrictedReference,
} from '@/lib/notes/shared/types'
import { formatDate } from '@/lib/date'

interface Props {
  references: References | null
  // The open note's title — highlighted within each excerpt.
  title: string
  onOpenNote: (path: string) => void
  /** Entity Context tabs hide the unlinked group — a profile answers "who links
   *  here", and speculative name matches are noise beside a person's own note.
   *  The standalone note view keeps them. */
  showUnlinked?: boolean
  // When given, each unlinked reference gets a "Link it" button that rewrites that
  // mention into a real link to the open note. Omitted when the viewer can't edit.
  onLinkMention?: (ref: UnlinkedReference) => Promise<void>
  // Files an access request for the hidden source note behind a locked stub.
  // Omitted in personal spaces (nothing is ever hidden there).
  onRequestReferenceAccess?: (ref: RestrictedReference) => Promise<void>
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
  onLink,
}: {
  refItem: LinkedReference | UnlinkedReference
  title: string
  onOpenNote: (path: string) => void
  onLink?: () => Promise<void>
}) {
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The block navigates (blackbird-brain behavior): hover draws a box around it,
  // click anywhere opens the source note. The date divider sits above, outside
  // the hover box, so highlighting doesn't swallow the date rule.
  const open = () => onOpenNote(refItem.fromPath)
  const link = async () => {
    if (!onLink || linking) return
    setLinking(true)
    setError(null)
    try {
      await onLink()
      // On success this reference drops out of the refreshed unlinked group, so
      // there's no success state to render.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link that mention')
    } finally {
      setLinking(false)
    }
  }
  return (
    <div className="notes-ref-item">
      <div className="notes-ref-date-divider">
        <span>{formatDate(refItem.date)}</span>
      </div>
      <div className="notes-ref-row">
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
            {error && <span className="notes-ref-link-error">{error}</span>}
          </div>
          <p className="notes-ref-excerpt">{highlight(refItem.excerpt, title)}</p>
        </div>
        {onLink && (
          <button
            type="button"
            className="notes-ref-link-btn"
            onClick={link}
            disabled={linking}
            title={`Link this mention to ${title}`}
          >
            {linking ? 'Linking…' : 'Link it'}
          </button>
        )}
      </div>
    </div>
  )
}

// A reference from a note the viewer can't read: the excerpt's place is held by
// blurred inert bars (never real text — the server sent none), a lock marks the
// corner, and the only action is asking for access to the hidden source note.
function LockedReference({
  refItem,
  onRequest,
}: {
  refItem: RestrictedReference
  onRequest?: () => Promise<void>
}) {
  const [state, setState] = useState<'idle' | 'requesting' | 'pending'>(
    refItem.pending ? 'pending' : 'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const request = async () => {
    if (!onRequest || state !== 'idle') return
    setState('requesting')
    setError(null)
    try {
      await onRequest()
      setState('pending')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request access')
      setState('idle')
    }
  }
  const pending = state === 'pending'
  return (
    <div className="notes-ref-item">
      <div className="notes-ref-date-divider">
        <span>{formatDate(refItem.date)}</span>
      </div>
      <div className="notes-ref-row">
        <div className="notes-ref-block notes-ref-locked" aria-label="A note you don't have access to references this">
          <Lock className="notes-ref-lock-icon" aria-hidden="true" strokeWidth={1.5} />
          <div className="notes-ref-locked-lines" aria-hidden="true">
            <span className="notes-ref-locked-line" style={{ width: '38%' }} />
            <span className="notes-ref-locked-line" style={{ width: '86%' }} />
            <span className="notes-ref-locked-line" style={{ width: '64%' }} />
          </div>
          <div className="notes-ref-locked-foot">
            {error && <span className="notes-ref-link-error">{error}</span>}
            {onRequest &&
              (pending ? (
                <span className="notes-ref-locked-pending">Request pending</span>
              ) : (
                <button
                  type="button"
                  className="notes-ref-get-access"
                  onClick={request}
                  disabled={state === 'requesting'}
                >
                  {state === 'requesting' ? 'Requesting…' : 'Get access'}
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function LinkedReferences({
  references,
  title,
  onOpenNote,
  onLinkMention,
  onRequestReferenceAccess,
  showUnlinked = true,
}: Props) {
  // Most recent source note first within each group.
  const linked = [...(references?.linked ?? [])].sort((a, b) => b.date - a.date)
  const unlinked = showUnlinked ? [...(references?.unlinked ?? [])].sort((a, b) => b.date - a.date) : []
  // Locked stubs render under the group their hidden reference belongs to;
  // unlinked-only stubs follow the same showUnlinked rule as readable ones.
  const restricted = references?.restricted ?? []
  const lockedLinked = restricted.filter((r) => r.kind === 'linked').sort((a, b) => b.date - a.date)
  const lockedUnlinked = showUnlinked
    ? restricted.filter((r) => r.kind === 'unlinked').sort((a, b) => b.date - a.date)
    : []
  if (linked.length + unlinked.length + lockedLinked.length + lockedUnlinked.length === 0) return null

  const locked = (stubs: RestrictedReference[]) =>
    stubs.map((ref) => (
      <LockedReference
        key={ref.token}
        refItem={ref}
        onRequest={onRequestReferenceAccess ? () => onRequestReferenceAccess(ref) : undefined}
      />
    ))

  return (
    <div className="notes-references">
      {linked.length + lockedLinked.length > 0 && (
        <section className="notes-ref-group">
          <h3 className="notes-ref-head">Linked references</h3>
          {linked.map((ref, i) => (
            <Reference key={`l-${i}`} refItem={ref} title={title} onOpenNote={onOpenNote} />
          ))}
          {locked(lockedLinked)}
        </section>
      )}

      {unlinked.length + lockedUnlinked.length > 0 && (
        <section className="notes-ref-group">
          <h3 className="notes-ref-head">Unlinked references</h3>
          {unlinked.map((ref) => (
            // Keyed by source + mention offset so the per-item link state stays
            // with its reference when the group is refreshed after a link.
            <Reference
              key={`u-${ref.fromPath}-${ref.offset}`}
              refItem={ref}
              title={title}
              onOpenNote={onOpenNote}
              onLink={onLinkMention ? () => onLinkMention(ref) : undefined}
            />
          ))}
          {locked(lockedUnlinked)}
        </section>
      )}
    </div>
  )
}
