'use client'

// A keyboard-driven search overlay. Reused for the `[[` link-autocomplete picker
// and the Ctrl-P quick switcher. Pure presentational — the caller supplies the
// note list (and, for `[[`, the directory entities) and handles the pick. When
// `entities` is supplied they're shown first, as avatar rows, so `[[Craig Piggott]]`
// resolves to a directory person/company.
//
// Two layouts: the Ctrl-P switcher is a centered modal; the `[[` picker passes an
// `anchor` (the caret's viewport rect) and renders as a compact dropdown tucked
// just below where the user is typing.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Avatar from '@/components/ui/Avatar'

interface NoteRef {
  path: string
  title: string
}

export interface PickerEntity {
  id: string
  name: string
  type: string
  image_url?: string | null
  subtitle?: string | null
  /** The node's community alias, if it holds one — the name its type goes by
   *  here ("Portfolio Company" for a Community). Display only: resolve it
   *  through the community's own alias list before showing it (nodeTypeLabel). */
  alias?: string | null
}

interface NotePickerProps {
  notes: NoteRef[]
  placeholder?: string
  onPick: (path: string) => void
  onClose: () => void
  entities?: PickerEntity[]
  onPickEntity?: (entity: PickerEntity) => void
  // When supplied, render as a compact dropdown anchored just below the caret (the
  // `[[` autocomplete) instead of a centered modal (the Ctrl-P quick switcher).
  // Coords are viewport-relative — typically from EditorView.coordsAtPos().
  anchor?: { left: number; top: number; bottom: number } | null
}

function scoreText(text: string, query: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 100
  if (t.includes(q)) return 60
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 10 : 0
}

function score(note: NoteRef, query: string): number {
  const s = scoreText(note.title, query)
  if (s > 10) return s
  return note.path.toLowerCase().includes(query.toLowerCase()) ? Math.max(s, 30) : s
}

type Item =
  | { kind: 'entity'; key: string; entity: PickerEntity }
  | { kind: 'note'; key: string; note: NoteRef }

export function NotePicker({
  notes,
  placeholder = 'Search notes…',
  onPick,
  onClose,
  entities,
  onPickEntity,
  anchor,
}: NotePickerProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const entityResults = useMemo(() => {
    if (!entities?.length || !onPickEntity) return []
    return entities
      .map((e) => ({ e, s: scoreText(e.name, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
      .slice(0, 8)
      .map((r) => r.e)
  }, [entities, onPickEntity, query])

  const noteResults = useMemo(() => {
    return notes
      .map((n) => ({ note: n, s: score(n, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.note.title.localeCompare(b.note.title))
      .slice(0, 50)
      .map((r) => r.note)
  }, [notes, query])

  const items = useMemo<Item[]>(
    () => [
      ...entityResults.map((e): Item => ({ kind: 'entity', key: `e:${e.id}`, entity: e })),
      ...noteResults.map((n): Item => ({ kind: 'note', key: `n:${n.path}`, note: n })),
    ],
    [entityResults, noteResults],
  )

  useEffect(() => {
    setActive(0)
  }, [query])

  // Anchored variant: place the dropdown just below the caret, then clamp it to the
  // viewport (slide left if it would overflow the right edge, flip above if it would
  // run off the bottom). Re-runs as the result count — and thus the height — changes.
  useLayoutEffect(() => {
    if (!anchor) return
    const el = panelRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    const gap = 6
    let left = anchor.left
    if (left + width + margin > window.innerWidth) left = window.innerWidth - width - margin
    if (left < margin) left = margin
    let top = anchor.bottom + gap
    if (top + height + margin > window.innerHeight) {
      const above = anchor.top - height - gap
      top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin)
    }
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
  }, [anchor, items.length])

  const pick = (item: Item | undefined) => {
    if (!item) return
    if (item.kind === 'entity') onPickEntity?.(item.entity)
    else onPick(item.note.path)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(items[active])
    }
  }

  const firstNoteIdx = entityResults.length

  const body = (
    <>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`w-full border-b border-border-subtle bg-transparent px-4 text-text-primary placeholder:text-text-muted focus:outline-none ${
          anchor ? 'py-2.5 text-sm' : 'py-3 text-base'
        }`}
      />
      <div className={`overflow-y-auto py-1 ${anchor ? 'max-h-72' : 'max-h-[50vh]'}`}>
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-text-muted">No matches</div>
        ) : (
          items.map((item, i) => (
            <div key={item.key}>
              {i === 0 && entityResults.length > 0 && <PickerGroupLabel>People &amp; spaces</PickerGroupLabel>}
              {i === firstNoteIdx && noteResults.length > 0 && entityResults.length > 0 && (
                <PickerGroupLabel>Notes</PickerGroupLabel>
              )}
              {item.kind === 'entity' ? (
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2 text-left transition ${
                    i === active ? 'bg-surface-3' : 'hover:bg-surface-2'
                  }`}
                >
                  <Avatar name={item.entity.name} imageUrl={item.entity.image_url} size="chip" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text-primary">{item.entity.name}</span>
                    {item.entity.subtitle && (
                      <span className="block truncate text-xs text-text-muted">{item.entity.subtitle}</span>
                    )}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item)}
                  className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition ${
                    i === active ? 'bg-surface-3' : 'hover:bg-surface-2'
                  }`}
                >
                  <span className="text-sm font-medium text-text-primary">{item.note.title}</span>
                  <span className="text-xs text-text-muted">{item.note.path}</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </>
  )

  // `[[` autocomplete: a compact dropdown pinned to the caret. The full-screen
  // catcher closes it on an outside click; the panel is hidden for the first frame
  // until the layout effect has measured + placed it, so it never flashes mid-screen.
  if (anchor) {
    return (
      <>
        <div className="fixed inset-0 z-40" onMouseDown={onClose} />
        <div
          ref={panelRef}
          className="fixed z-50 w-80 overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-float"
          style={
            pos
              ? { left: pos.left, top: pos.top }
              : { left: anchor.left, top: anchor.bottom + 6, visibility: 'hidden' }
          }
          onMouseDown={(e) => e.stopPropagation()}
        >
          {body}
        </div>
      </>
    )
  }

  // Ctrl-P quick switcher: a centered modal overlay.
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh] px-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  )
}

function PickerGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{children}</div>
  )
}
