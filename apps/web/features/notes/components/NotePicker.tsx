'use client'

// A keyboard-driven search overlay. Reused for the `[[` link-autocomplete picker
// and the Ctrl-P quick switcher. Pure presentational — the caller supplies the
// note list (and, for `[[`, the directory entities) and handles the pick.
//
// It is drawn as the context tree: folders with their guide lines, a folder
// glyph that opens and shuts, notes as file rows. A directory entity sits
// where its note lives (`people/aiko/index.md`), whether or not that note has
// been written yet, so `[[Aiko` still finds a person with no note. Typing
// prunes the tree to what matches and opens every folder on the way to it.
//
// Two layouts: the Ctrl-P switcher is a centered modal; the `[[` picker passes an
// `anchor` (the caret's viewport rect) and renders as a compact dropdown tucked
// just below where the user is typing.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { scoreText } from '@/lib/fuzzy'
import { entityNotePath } from '@/lib/notes/entities'
import {
  buildPickerTree,
  prunePickerTree,
  titleOf,
  visiblePickerRows,
  type PickerLeaf,
  type PickerRow,
} from '@/lib/notes/shared/pickerTree'
import { TreeFileIcon, TreeFolderIcon, TreeGuide, TreeStem } from '@/components/ui/TreeChrome'

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
  /** The node's space alias, if it holds one — the name its type goes by
   *  here ("Portfolio Company" for a Space). Display only: resolve it
   *  through the space's own alias list before showing it (nodeTypeLabel). */
  alias?: string | null
  /** The node's stored metadata — `metadata.notePath` says whether its note
   *  has become an entity folder, which is what entityNotePath needs. */
  metadata?: Record<string, unknown> | null
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

// A tree is scanned by eye, so only a real substring counts as a match: a
// subsequence hit ("anr" in "Aiko Tanaka Notes") opens folders for nothing.
const MATCH_FLOOR = 60

type Ref = { kind: 'entity'; entity: PickerEntity } | { kind: 'note' }

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
  // The folders open by hand, for the query they were opened under: a new
  // query starts from the folders its matches sit in.
  const [opened, setOpened] = useState<{ q: string; paths: Set<string> }>(() => ({ q: '', paths: new Set() }))
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const tree = useMemo(() => {
    const leaves: PickerLeaf<Ref>[] = []
    // An entity takes its note's place, so picking it links the person (and
    // writes the note if it is missing) rather than the bare file.
    if (entities?.length && onPickEntity) {
      for (const entity of entities) {
        const path = entityNotePath(entity)
        if (path) leaves.push({ path, title: entity.name, ref: { kind: 'entity', entity } })
      }
    }
    for (const note of notes) leaves.push({ path: note.path, title: note.title, ref: { kind: 'note' } })
    return buildPickerTree(leaves)
  }, [notes, entities, onPickEntity])

  const q = query.trim()
  const pruned = useMemo(
    () => (q ? prunePickerTree(tree, (title) => scoreText(title, q) >= MATCH_FLOOR) : { nodes: tree, open: null }),
    [tree, q],
  )
  const openPaths = useMemo(
    () => (opened.q === q ? opened.paths : (pruned.open ?? new Set<string>())),
    [opened, q, pruned],
  )
  const rows = useMemo(
    () => visiblePickerRows(pruned.nodes, (path) => openPaths.has(path)),
    [pruned, openPaths],
  )

  // A query lands on its best match rather than on the first folder above it.
  useEffect(() => {
    if (!q) { setActive(0); return }
    let best = 0
    let bestScore = -1
    rows.forEach((row, i) => {
      const s = scoreText(titleOf(row.node), q)
      if (s > bestScore) { best = i; bestScore = s }
    })
    setActive(best)
    // Only a new query re-aims; opening a folder must not move the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Anchored variant: place the dropdown just below the caret, then clamp it to the
  // viewport (slide left if it would overflow the right edge, flip above if it would
  // run off the bottom). Re-runs as the row count — and thus the height — changes.
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
  }, [anchor, rows.length])

  const toggle = (path: string, open?: boolean) => {
    const next = new Set(openPaths)
    if (open ?? !next.has(path)) next.add(path)
    else next.delete(path)
    setOpened({ q, paths: next })
  }

  const pickLeaf = (leaf: PickerLeaf<Ref>) => {
    if (leaf.ref.kind === 'entity') onPickEntity?.(leaf.ref.entity)
    else onPick(leaf.path)
  }

  // A row does what its name does in the sidebar: a note links, a folder
  // with a note of its own links that note, a bare folder opens.
  const choose = (row: PickerRow<Ref> | undefined) => {
    if (!row) return
    const node = row.node
    if (node.kind === 'leaf') pickLeaf(node.leaf)
    else if (node.index) pickLeaf(node.index)
    else toggle(node.path)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[active]
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'ArrowRight' && row?.node.kind === 'folder') {
      e.preventDefault()
      if (!row.open) toggle(row.node.path, true)
      else setActive((a) => Math.min(a + 1, rows.length - 1))
    } else if (e.key === 'ArrowLeft' && row) {
      e.preventDefault()
      if (row.node.kind === 'folder' && row.open) { toggle(row.node.path, false); return }
      // Step out to the folder this row hangs from.
      const depth = row.guides.length
      for (let i = active - 1; i >= 0; i--) {
        if (rows[i].guides.length < depth) { setActive(i); break }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(row)
    }
  }

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
      <div
        ref={listRef}
        className={`overflow-y-auto overscroll-contain py-1 custom-scrollbar ${anchor ? 'max-h-80' : 'max-h-[50vh]'}`}
      >
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-text-muted">No matches</div>
        ) : (
          rows.map((row, i) => (
            <PickerTreeRow
              key={row.node.kind === 'folder' ? `f:${row.node.path}` : `n:${row.node.leaf.path}`}
              index={i}
              row={row}
              active={i === active}
              onHover={() => setActive(i)}
              onToggle={() => row.node.kind === 'folder' && toggle(row.node.path)}
              onChoose={() => choose(row)}
            />
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
          className="fixed z-50 w-[340px] overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-float"
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

/** One row of the tree, drawn with the sidebar's chrome: a guide per level
 *  (a line through where an ancestor has siblings still to come), the join
 *  into this row, then the glyph and the name. */
function PickerTreeRow({
  index,
  row,
  active,
  onHover,
  onToggle,
  onChoose,
}: {
  index: number
  row: PickerRow<Ref>
  active: boolean
  onHover: () => void
  onToggle: () => void
  onChoose: () => void
}) {
  const { node, guides, open } = row
  const ancestors = guides.slice(0, -1)
  const own = guides[guides.length - 1]
  const title = titleOf(node)
  return (
    <div
      data-row={index}
      onMouseEnter={onHover}
      className={clsx('flex items-stretch pr-3 pl-2 transition-colors', active ? 'bg-surface-2' : '')}
    >
      {/* Each level sits 26px in from the one above — a 12px guide cell and
          14px to the next — so a child's guide lands under its folder glyph. */}
      {guides.length > 0 && <span className="w-[14px] shrink-0" aria-hidden />}
      {ancestors.map((g, j) => (
        <span key={j} className="flex shrink-0" aria-hidden>
          <span className="relative w-3 self-stretch">
            {g === 'mid' && <span className="absolute inset-y-0 left-0 w-px bg-border-default/70" />}
          </span>
          <span className="w-[14px]" />
        </span>
      ))}
      {own && <TreeGuide guide={own} />}
      {node.kind === 'folder' ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggle}
          className="relative flex shrink-0 items-center px-1.5 text-text-muted hover:text-text-primary"
        >
          {open && node.children.length > 0 && <TreeStem />}
          <TreeFolderIcon open={open} />
        </button>
      ) : (
        <span className="flex shrink-0 items-center px-1.5 text-text-muted">
          <TreeFileIcon />
        </span>
      )}
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onChoose}
        className="flex min-w-0 flex-1 items-center py-1.5 text-left text-[14px]"
      >
        <span className={clsx('truncate', node.kind === 'folder' ? 'font-medium text-text-secondary' : 'text-text-primary')}>
          {title}
        </span>
      </button>
    </div>
  )
}
