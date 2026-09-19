'use client'

// Roam-style backlinks rendered below the note body, inside the editor's scroll
// column — linked + unlinked references (each with the source title, date, and
// excerpt). Typographic, not boxed: the references read as a continuation of
// the note.
//
// One search sits above both groups and filters them together (by source title
// or excerpt text). Each group is a disclosure: linked opens by default,
// unlinked — speculative name matches — stays shut until wanted, and a search
// opens whichever group it finds something in.

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRightIcon, LockIcon, SearchIcon } from '@/features/shared/icons'
import { SearchInput } from '@/components/ui'
import type {
  References,
  LinkedReference,
  UnlinkedReference,
  RestrictedReference,
} from '@/lib/notes/shared/types'
import { escapeRegExp } from '@/lib/notes/shared/references'
import { formatDate } from '@/lib/date'

/** Rows shown before "Show all" — enough to see what kind of thing links here. */
const PREVIEW_COUNT = 5

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

// Wrap every match of `re` inside the string parts of `nodes`. Applied twice per
// excerpt — once for the note's own title, once for the filter terms — so the
// two highlights compose instead of one clobbering the other.
function mark(nodes: ReactNode[], re: RegExp, className: string): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  for (const node of nodes) {
    if (typeof node !== 'string') {
      out.push(node)
      continue
    }
    let last = 0
    for (const m of node.matchAll(re)) {
      const start = m.index ?? 0
      if (start > last) out.push(node.slice(last, start))
      out.push(
        <span key={`${className}-${key++}`} className={className}>
          {m[0]}
        </span>,
      )
      last = start + m[0].length
    }
    if (last < node.length) out.push(node.slice(last))
  }
  return out
}

// Whole-word, case-insensitive matches of the open note's title, plus substring
// matches of whatever the filter is looking for.
function highlight(text: string, title: string, terms: string[]): ReactNode[] {
  let nodes: ReactNode[] = [text]
  if (title) {
    nodes = mark(nodes, new RegExp(`(?<![\\w])(${escapeRegExp(title)})(?![\\w])`, 'gi'), 'notes-ref-mention')
  }
  for (const term of terms) {
    nodes = mark(nodes, new RegExp(`(${escapeRegExp(term)})`, 'gi'), 'notes-ref-hit')
  }
  return nodes
}

function Reference({
  refItem,
  title,
  terms,
  onOpenNote,
  onLink,
}: {
  refItem: LinkedReference | UnlinkedReference
  title: string
  terms: string[]
  onOpenNote: (path: string) => void
  onLink?: () => Promise<void>
}) {
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The block navigates: hover draws a box around it, click anywhere opens the
  // source note. The date rides the head row beside the title — a rule between
  // every row is what made a long list read as clutter.
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
              {highlight(refItem.fromTitle, '', terms)}
            </button>
            <span className="notes-ref-date">{formatDate(refItem.date)}</span>
            {error && <span className="notes-ref-link-error">{error}</span>}
          </div>
          <p className="notes-ref-excerpt">{highlight(refItem.excerpt, title, terms)}</p>
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
      <div className="notes-ref-row">
        <div className="notes-ref-block notes-ref-locked" aria-label="A note you don't have access to references this">
          <LockIcon className="notes-ref-lock-icon" aria-hidden="true" strokeWidth={1.5} />
          <div className="notes-ref-head-row">
            <span className="notes-ref-date">{formatDate(refItem.date)}</span>
          </div>
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

// One collapsible group: chevron, label, count. Everything else — the filter,
// the rows, the "show more" — lives behind the disclosure, so a closed group is
// exactly one line and an open one carries its own search.
function RefGroup({
  label,
  items,
  locked,
  defaultOpen,
  terms,
  renderItem,
  renderLocked,
}: {
  label: string
  items: (LinkedReference | UnlinkedReference)[]
  locked: RestrictedReference[]
  defaultOpen: boolean
  terms: string[]
  renderItem: (ref: LinkedReference | UnlinkedReference, terms: string[], i: number) => ReactNode
  renderLocked: (ref: RestrictedReference) => ReactNode
}) {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const [showAll, setShowAll] = useState(false)
  const filtering = terms.length > 0
  // Every term must appear in the source title or the excerpt, so adding a word
  // narrows rather than widens.
  const matches = useMemo(
    () =>
      filtering
        ? items.filter((ref) =>
            terms.every(
              (t) => ref.fromTitle.toLowerCase().includes(t) || ref.excerpt.toLowerCase().includes(t),
            ),
          )
        : items,
    [items, terms, filtering],
  )
  // A locked stub carries no text at all, so it can't match a filter — the count
  // in the head is what says they're still there.
  const stubs = filtering ? [] : locked
  const total = items.length + locked.length
  const shown = matches.length + stubs.length
  // While filtering, everything that matched is shown — the point of narrowing is
  // to see the result, not to page through it.
  const capped = filtering || showAll ? matches : matches.slice(0, PREVIEW_COUNT)
  const cappedStubs =
    filtering || showAll ? stubs : stubs.slice(0, Math.max(0, PREVIEW_COUNT - capped.length))
  const hidden = total - (capped.length + cappedStubs.length)
  // A search opens a group it found something in; a press always wins.
  const open = toggled ?? (filtering ? shown > 0 : defaultOpen)

  return (
    <section className="notes-ref-group">
      <h3 className="notes-ref-head">
        <button
          type="button"
          className="notes-ref-head-btn"
          onClick={() => setToggled(!open)}
          aria-expanded={open}
        >
          <ChevronRightIcon
            className={`notes-ref-chevron${open ? ' notes-ref-chevron-open' : ''}`}
            aria-hidden="true"
            strokeWidth={1.75}
          />
          <span>{label}</span>
          <span className="notes-ref-count">{filtering ? `${shown} of ${total}` : total}</span>
        </button>
      </h3>
      {open && (
        <>
          {capped.map((ref, i) => renderItem(ref, terms, i))}
          {cappedStubs.map(renderLocked)}
          {hidden > 0 && !filtering && (
            <button type="button" className="notes-ref-more" onClick={() => setShowAll(true)}>
              Show {hidden} more
            </button>
          )}
        </>
      )}
    </section>
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
  const [query, setQuery] = useState('')
  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query])
  const groups = useMemo(() => {
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
    return { linked, unlinked, lockedLinked, lockedUnlinked }
  }, [references, showUnlinked])

  const totalLinked = groups.linked.length + groups.lockedLinked.length
  const totalUnlinked = groups.unlinked.length + groups.lockedUnlinked.length
  if (totalLinked + totalUnlinked === 0) return null

  const lockedRow = (ref: RestrictedReference) => (
    <LockedReference
      key={ref.token}
      refItem={ref}
      onRequest={onRequestReferenceAccess ? () => onRequestReferenceAccess(ref) : undefined}
    />
  )

  return (
    <div className="notes-references">
      <div className="notes-ref-toolbar">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search references…"
          icon={<SearchIcon className="notes-ref-search-icon" strokeWidth={1.75} />}
          className="notes-ref-search"
        />
      </div>
      {totalLinked > 0 && (
        <RefGroup
          label="Linked references"
          items={groups.linked}
          locked={groups.lockedLinked}
          // Linked answers "who points at this" and is the reason the section
          // exists, so it opens; unlinked is a suggestion list and stays shut.
          defaultOpen
          terms={terms}
          renderLocked={lockedRow}
          renderItem={(ref, terms, i) => (
            <Reference key={`l-${i}`} refItem={ref} title={title} terms={terms} onOpenNote={onOpenNote} />
          )}
        />
      )}

      {totalUnlinked > 0 && (
        <RefGroup
          label="Unlinked references"
          items={groups.unlinked}
          locked={groups.lockedUnlinked}
          defaultOpen={false}
          terms={terms}
          renderLocked={lockedRow}
          renderItem={(ref, terms) => {
            const unlinkedRef = ref as UnlinkedReference
            return (
              // Keyed by source + mention offset so the per-item link state stays
              // with its reference when the group is refreshed after a link.
              <Reference
                key={`u-${unlinkedRef.fromPath}-${unlinkedRef.offset}`}
                refItem={unlinkedRef}
                title={title}
                terms={terms}
                onOpenNote={onOpenNote}
                onLink={onLinkMention ? () => onLinkMention(unlinkedRef) : undefined}
              />
            )
          }}
        />
      )}
    </div>
  )
}
