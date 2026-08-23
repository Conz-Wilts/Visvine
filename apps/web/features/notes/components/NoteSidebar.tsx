'use client'

// The notes sidebar: starred notes and a folder/note tree. Folders expand/collapse
// and carry a folder icon; notes carry their frontmatter type's glyph (person,
// group, event, resource) or a document icon when untyped. Row actions (star,
// delete, share) live behind a single â‹¯ menu revealed on hover â€” starred state
// shows only there and in the Starred section above the tree, never as a glyph
// on the row. Starring is the same `starred:` frontmatter flag the editor
// toolbar's star toggles, so both surfaces always agree. Nesting is shown
// with tree guides: each nested row draws its own segment of the vertical line
// plus an elbow into its icon, and the last child of a folder closes the line
// off with a rounded corner, so depth reads at a glance. Expanding a folder
// tweens its branch open and drops the rows in one after another rather than
// swapping them in on a frame (see `Branch`). The tree scrolls with
// its scrollbar on the right (normal) edge. A Trash folder is pinned below everything: deleted
// notes live there for a week (restore or delete-forever from the row menu)
// before the server purges them.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal, inputBaseClass } from '@/components/ui'
import type { NoteMeta, TreeNode, TrashEntry } from '@/lib/notes/shared/types'
import { TRASH_RETENTION_DAYS } from '@/lib/notes/shared/types'
import { getNodeGlyph } from '@/lib/types'
import { NODE_GLYPH_PATHS, type NodeGlyph } from '@/lib/avatarUtils'
import { entityKindOf } from '@/lib/notes/entities'
import { isIndexPath } from '@/lib/notes/shared/indexNote'
import { TRASH_PATH, useContextTreeState } from '@/features/notes/hooks/useContextTreeState'
import { canMoveInto, deleteFolderDenial, moveDenial, parentFolderOf } from '../lib/useContextTree'

// Expansion state (openPaths + reveal overlay + persistence) lives in
// useContextTreeState, shared with the full-screen Context explorer so both
// surfaces read and write the same per-space blob.
// VS Code-style row band: the hover/selection background runs the FULL panel
// width, square-edged, regardless of how deeply the row is nested. Rows sit
// inside per-level indent containers, so the depth offset isn't knowable here â€”
// instead the row box is pulled far to the left and given matching padding
// back, which leaves its content exactly where it was and lets the background
// (and the guide lines it covers) bleed out to the panel edge. The scroll
// container clips the overhang with overflow-x-hidden.
const ROW_BLEED = '-ml-[999px] pl-[999px]'

// Tree guides. A nested row draws its OWN piece of the vertical line rather
// than inheriting one border from the indent container: the last child of a
// folder then ends the line at its own elbow instead of trailing past it, and
// the line sits above the row band so a hovered row does not paint over it.
// `mid` is a T (line through, tick out), `last` is a rounded elbow.
type Guide = 'mid' | 'last'
// Indents that keep every level's line centred under its parent's chevron:
// chevron centre is 6 + 16/2 = 14px into the row content, plus the 12px guide
// column once the row itself is nested.
const CHILD_INDENT = 'ml-[14px]'
const NESTED_CHILD_INDENT = 'ml-[26px]'

function GuideLine({ guide, active = false }: { guide: Guide; active?: boolean }) {
  // A guide on the path to the open note is tinted, so the branch you are
  // inside reads as a trail from the root down rather than as identical grey
  // lines at every level.
  const line = active ? 'bg-brand-green/60' : 'bg-border-default/70'
  const edge = active ? 'border-brand-green/60' : 'border-border-default/70'
  return (
    <span className="relative flex w-3 shrink-0 self-stretch" aria-hidden="true">
      {guide === 'last' ? (
        <span className={`absolute left-0 top-0 h-1/2 w-2.5 rounded-bl-[6px] border-b border-l ${edge}`} />
      ) : (
        <>
          <span className={`absolute left-0 top-0 h-full w-px ${line}`} />
          <span className={`absolute left-0 top-1/2 h-px w-2.5 ${line}`} />
        </>
      )}
    </span>
  )
}

// A folder's children, revealed with a height tween instead of appearing on a
// single frame. `grid-template-rows: 0fr -> 1fr` on the wrapper animates to the
// content's natural height with nothing measured, and the rows inside stagger
// in (`.ctx-branch`, globals.css). Collapsing keeps the subtree mounted for the
// length of the tween so the fold reads in both directions; `mounted` is what
// unmounts it afterwards, so a shut folder costs nothing.
//
// Two things keep it feeling instant on a big folder:
//   - The open state is set from a LAYOUT effect after a forced reflow, not
//     from rAF. Waiting for a frame to establish the 0fr start value put ~45ms
//     of dead air between the click and the first pixel of movement; reading
//     scrollHeight establishes it inside the click's own task instead.
//   - A subtree taller than the panel skips the height tween entirely (see
//     TALL_BRANCH_PX). Sliding 6000px of rows open takes the full duration to
//     reveal content that was never going to be on screen, which is exactly the
//     "opens, sits empty, then the files appear" the tween was meant to fix.
const BRANCH_MS = 180
const TALL_BRANCH_PX = 640

function Branch({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open)
  // Starts at `open` so a tree that loads with folders already expanded renders
  // them open rather than playing an entrance for state the user never changed.
  const [expanded, setExpanded] = useState(open)
  const [tall, setTall] = useState(false)
  // The row cascade is an ENTRANCE, not a style: it plays when this folder is
  // opened, never when the tree re-mounts (which it does on every navigation)
  // with the folder already open. Marking the branch instead of the rows keeps
  // the flag where the open transition is known.
  const [entering, setEntering] = useState(false)
  const inner = useRef<HTMLDivElement | null>(null)

  // Mounting in an effect would cost a frame before the rows even exist —
  // adjusting the state during the render that opened the folder puts them in
  // the same commit, which is what lets the layout effect below measure and
  // expand without ever painting an empty branch.
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) return
    setExpanded(false)
    const timer = setTimeout(() => setMounted(false), tall ? 0 : BRANCH_MS)
    return () => clearTimeout(timer)
  }, [open, tall])

  useLayoutEffect(() => {
    if (!open || expanded || !mounted || !inner.current) return
    // The read is the point: it flushes layout with the wrapper still at 0fr,
    // so flipping to 1fr on the next line is a change the transition can run.
    const height = inner.current.scrollHeight
    setTall(height > TALL_BRANCH_PX)
    setEntering(true)
    setExpanded(true)
  }, [open, expanded, mounted])

  if (!mounted) return null
  return (
    <div
      className={`ctx-branch-wrap grid ${entering ? 'ctx-branch-enter' : ''} ${
        tall ? '' : 'transition-[grid-template-rows] duration-[180ms] ease-out'
      } ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
    >
      {/* Clipped on the vertical axis only: rows bleed 999px to the left to
          paint their hover band to the panel edge, and `overflow: hidden` here
          would cut that off. `visible` pairs legally with `clip` where it
          cannot with `hidden`.

          `min-w-0` is load-bearing, not tidying: a grid item's automatic
          minimum size is its MIN-CONTENT width, and ROW_BLEED gives every row
          999px of left padding — so without it the column sizes itself to that
          and the branch overflows the panel to the RIGHT. One level of nesting
          was enough to push each row's trailing ⋯ menu past the panel's
          `overflow-hidden` edge, which silently took Share/Move/Delete away
          from every note inside a folder while the top-level rows kept theirs. */}
      <div ref={inner} className="min-h-0 min-w-0 overflow-x-visible overflow-y-clip">
        {children}
      </div>
    </div>
  )
}

/** Is `path` the open note, or the folder that contains it? */
function onSelectedPath(path: string, selectedPath: string | null): boolean {
  if (!selectedPath) return false
  return selectedPath === path || selectedPath.startsWith(`${path}/`)
}

// Where the tree was scrolled to, per scope, kept for the lifetime of the tab.
// The docked tree re-mounts on every navigation (each page renders its own
// ContextSidebar), and a fresh scroll container starts at 0 â€” so clicking a note
// half-way down the tree would snap the list to the top and then smooth-scroll
// back. Restoring the offset on mount makes the swap invisible.
const scrollMemory = new Map<string, number>()

// The glyph for a note's frontmatter type. `entityKindOf` is the wider net â€”
// it catches retired organisation spellings getNodeGlyph has no entry for â€” so
// those notes still read as the cluster glyph rather than falling back to
// initials.
function noteGlyph(type: string | undefined): NodeGlyph | null {
  return getNodeGlyph(type) ?? (entityKindOf(type) === 'space' ? 'group' : null)
}

/** Access adornments for a folder row at ANY depth (shared context only):
 *  restricted = a grant boundary (ðŸ”’), plus the viewer's own level chip. */
interface FolderBadge {
  restricted: boolean
  locked?: boolean
  /** The viewer's own effective level at the folder ('view' or 'edit'). */
  level?: string
}

/** A row the tree can move: a note, or a folder (with everything under it). */
interface MovableItem {
  path: string
  kind: 'note' | 'folder'
  label: string
}

/** Drag-to-move state, shared with every row rather than threaded through the
 *  recursive Tree/FolderRow props (they already carry a dozen). Null when the
 *  host surface passed no move handlers — rows then aren't draggable at all. */
interface TreeDragValue {
  dragging: MovableItem | null
  /** Folder currently under the pointer ('' = the context root, null = none). */
  dropFolder: string | null
  begin: (item: MovableItem) => void
  end: () => void
  hover: (folderPath: string | null) => void
  move: (item: MovableItem, destFolder: string) => void
  /** Opens the "Move to…" dialog — the keyboard/menu path to the same move. */
  requestMove: (item: MovableItem) => void
}

const TreeDrag = createContext<TreeDragValue | null>(null)

/** Whether a row can be dragged at all: moving it to the folder it already sits
 *  in is a no-op, so a denial there is purely about the item itself (entity
 *  note, folder index, managed namespace). */
function isMovable(path: string, kind: 'note' | 'folder'): boolean {
  return moveDenial(path, kind, parentFolderOf(path)) === null
}

interface NoteSidebarProps {
  tree: TreeNode
  notes: NoteMeta[]
  starred: string[]
  selectedPath: string | null
  canEdit: boolean
  onSelect: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onDeleteNote: (path: string) => void
  /** Access badges keyed by FULL path â€” folders AND privately-restricted notes
   *  (shared scope only). */
  folderBadges?: Map<string, FolderBadge>
  /** Hover action on folder rows: open the folder's Share panel. */
  onFolderAccess?: (folderPath: string) => void
  /** â‹¯ menu action on note rows: open the note's Share panel. */
  onShareNote?: (path: string) => void
  /** â‹¯ menu action on folder rows: delete the folder (and the notes inside). */
  onDeleteFolder?: (folderPath: string, label?: string) => void
  /** File a note into another folder ('' = the context root). Passing both move
   *  handlers turns on dragging and the rows' "Move to..." action; omit them for
   *  a read-only tree. Authority stays server-side - a rejected move surfaces
   *  its message. */
  onMoveNote?: (from: string, destFolder: string) => void
  /** Move a folder and everything under it. */
  onMoveFolder?: (from: string, destFolder: string) => void
  /** Render without card chrome (bg/border/shadow) â€” used when the sidebar sits on
   *  the shared dock backdrop, which already supplies the background and shadow. */
  bare?: boolean
  /** Show the context root as a real (collapsible) folder row at the top of the
   *  tree instead of a separate header bar, so the space reads as the parent
   *  folder of everything below it. `icon` replaces the folder glyph; the root
   *  row shows no glyph at all when it's omitted. */
  root?: { label: string; icon?: React.ReactNode }
  /** Scopes the persisted expand/collapse state (pass the space id). Omit to
   *  keep the state in memory only. */
  storageKey?: string | null
  /** Soft-deleted notes for this context, shown as a Trash folder pinned to the
   *  bottom of the tree. Omit (or pass null) to hide the row entirely. */
  trash?: TrashEntry[] | null
  /** Trash row actions. Restore puts the note back at its original path;
   *  purge/empty delete permanently, ahead of the retention window. */
  onRestoreTrash?: (id: string) => void
  onPurgeTrash?: (id: string) => void
  onEmptyTrash?: () => void
  /** Open a trashed note's read-only preview. Omit to leave trash rows as
   *  plain labels. */
  onOpenTrash?: (entry: TrashEntry) => void
  /** Note to temporarily expand the tree down to (the context search's focused
   *  match, or the note a profile page has open). Unlike a click this never
   *  changes the saved expansion â€” clearing it collapses the peek back to
   *  whatever the user had open. */
  revealPath?: string | null
}

export function NoteSidebar({
  tree,
  notes,
  starred,
  selectedPath,
  canEdit,
  onSelect,
  onToggleStar,
  onDeleteNote,
  folderBadges,
  onFolderAccess,
  onShareNote,
  onDeleteFolder,
  onMoveNote,
  onMoveFolder,
  trash = null,
  onRestoreTrash,
  onPurgeTrash,
  onEmptyTrash,
  onOpenTrash,
  bare = false,
  root,
  storageKey = null,
  revealPath = null,
}: NoteSidebarProps) {
  const starredSet = useMemo(() => new Set(starred), [starred])
  const titleFor = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of notes) map.set(n.path, n.title)
    return map
  }, [notes])

  const glyphFor = useMemo(() => {
    const map = new Map<string, NodeGlyph>()
    for (const n of notes) {
      const glyph = noteGlyph(n.frontmatter.type)
      if (glyph) map.set(n.path, glyph)
    }
    return map
  }, [notes])

  const starredNotes = useMemo(
    () => starred.map((p) => ({ path: p, title: titleFor.get(p) ?? p })).filter((n) => titleFor.has(n.path)),
    [starred, titleFor],
  )

  // Moving: dragging a row onto a folder, or the same move from the row menu
  // via the "Move to..." dialog. Both go through one `move` so the rules and the
  // handlers stay in one place.
  const [dragging, setDragging] = useState<MovableItem | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<MovableItem | null>(null)
  const movingEnabled = canEdit && !!onMoveNote && !!onMoveFolder

  const drag = useMemo<TreeDragValue | null>(() => {
    if (!movingEnabled) return null
    const move = (item: MovableItem, destFolder: string) => {
      if (item.kind === 'folder') onMoveFolder!(item.path, destFolder)
      else onMoveNote!(item.path, destFolder)
    }
    return {
      dragging,
      dropFolder,
      begin: (item) => setDragging(item),
      end: () => {
        setDragging(null)
        setDropFolder(null)
      },
      hover: setDropFolder,
      move,
      requestMove: setMoveTarget,
    }
  }, [movingEnabled, dragging, dropFolder, onMoveNote, onMoveFolder])

  // Which folders are expanded â€” persisted per scope, with the reveal peek
  // layered on top (see useContextTreeState for the full story).
  const { effectiveOpenPaths, toggleFolder, openFolder } = useContextTreeState(storageKey, revealPath)

  // Keep the selected row in view when selection changes from outside the tree
  // (context search focus, profile navigation). An off-screen row is centred so it
  // lands mid-panel, not clinging to an edge; an already-visible row stays put,
  // so ordinary clicks never cause a jump. Retries a few frames because a
  // collapsed ancestor folder auto-opens in response to the same selection
  // change, so the row may only mount a render later.
  const scrollRef = useRef<HTMLDivElement>(null)

  // Restore before the reveal effect below runs, so an already-visible selected
  // row is found in place and no scroll animation plays at all.
  useEffect(() => {
    const el = scrollRef.current
    const saved = scrollMemory.get(storageKey ?? '')
    if (el && saved) el.scrollTop = saved
  }, [storageKey])

  const rememberScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      scrollMemory.set(storageKey ?? '', e.currentTarget.scrollTop)
    },
    [storageKey],
  )

  useEffect(() => {
    if (!selectedPath) return
    let raf = 0
    let attempts = 0
    const tryScroll = () => {
      const container = scrollRef.current
      const el = container?.querySelector(`[data-note-path="${CSS.escape(selectedPath)}"]`)
      if (container && el) {
        const c = container.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        if (r.top < c.top || r.bottom > c.bottom) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } else if (attempts++ < 5) {
        raf = requestAnimationFrame(tryScroll)
      }
    }
    tryScroll()
    return () => cancelAnimationFrame(raf)
  }, [selectedPath])

  return (
    <TreeDrag.Provider value={drag}>
    <div
      className={`flex h-full flex-col overflow-hidden ${
        /* bare = docked into the Sidebar column, which draws its own seam;
           floating = the tree beside a note, divided from it by one hairline */
        bare ? '' : 'border-r border-border-subtle'
      }`}
    >
      {/* overscroll-contain: hitting either end of the tree must not chain the
          wheel out to the page behind it (on the Context views that reads as the
          graph jumping while you scroll the tree). */}
      {/* overflow-x-hidden clips ROW_BLEED's overhang (overflow-y-auto alone
          would resolve x to auto and show a horizontal scrollbar). No px here:
          the row bands must reach both panel edges â€” rows carry their own
          inner padding. */}
      <div
        ref={scrollRef}
        onScroll={rememberScroll}
        className="scrollbar-on-hover flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-3"
      >
        {/* pl only â€” it insets the row CONTENT off the panel edge while the
            bands still bleed past it; a matching pr would pull the bands'
            right edge in and break the full-width look. */}
        <div className="pl-2">
          {starredNotes.length > 0 && (
            <div className="mb-2">
              <SectionLabel>Starred</SectionLabel>
              {starredNotes.map((n) => (
                <NoteRow
                  key={n.path}
                  title={n.title}
                  path={n.path}
                  glyph={glyphFor.get(n.path) ?? null}
                  selected={selectedPath === n.path}
                  starred
                  restrictedBadge={folderBadges?.get(n.path)?.restricted ?? false}
                  canEdit={canEdit}
                  onSelect={onSelect}
                  onToggleStar={onToggleStar}
                  onDelete={onDeleteNote}
                  onShare={onShareNote}
                />
              ))}
            </div>
          )}

          {root ? (
            // The context root as the tree's own top-level folder â€” same row
            // chrome as any other folder, so nesting reads uniformly from the
            // space down.
            <FolderRow
              node={tree}
              label={root.label}
              icon={root.icon ?? null}
              openPaths={effectiveOpenPaths}
              onToggleFolder={toggleFolder}
              onOpenFolder={openFolder}
              selectedPath={selectedPath}
              starredSet={starredSet}
              glyphFor={glyphFor}
              canEdit={canEdit}
              onSelect={onSelect}
              onToggleStar={onToggleStar}
              onDeleteNote={onDeleteNote}
              folderBadges={folderBadges}
              onFolderAccess={onFolderAccess}
              onShareNote={onShareNote}
              onDeleteFolder={onDeleteFolder}
            />
          ) : (
            <Tree
              node={tree}
              openPaths={effectiveOpenPaths}
              onToggleFolder={toggleFolder}
              onOpenFolder={openFolder}
              selectedPath={selectedPath}
              starredSet={starredSet}
              glyphFor={glyphFor}
              canEdit={canEdit}
              onSelect={onSelect}
              onToggleStar={onToggleStar}
              onDeleteNote={onDeleteNote}
              folderBadges={folderBadges}
              onFolderAccess={onFolderAccess}
              onShareNote={onShareNote}
              onDeleteFolder={onDeleteFolder}
            />
          )}

          {/* Trash sits at the very bottom of every context, below the whole tree
              â€” a folder-shaped row rather than a modal, so restoring reads as
              moving a note back rather than a separate admin surface. */}
          {trash && (
            <TrashFolder
              entries={trash}
              open={effectiveOpenPaths.has(TRASH_PATH)}
              onToggle={() => toggleFolder(TRASH_PATH, effectiveOpenPaths.has(TRASH_PATH))}
              onRestore={onRestoreTrash}
              onPurge={onPurgeTrash}
              onEmpty={onEmptyTrash}
              onOpen={onOpenTrash}
            />
          )}
        </div>
      </div>
    </div>
    {moveTarget && drag && (
      <MoveDialog
        item={moveTarget}
        tree={tree}
        rootLabel={root?.label ?? 'Context root'}
        onClose={() => setMoveTarget(null)}
        onPick={(destFolder) => {
          setMoveTarget(null)
          drag.move(moveTarget, destFolder)
        }}
      />
    )}
    </TreeDrag.Provider>
  )
}

// â”€â”€ Trash â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Whole days left before the server purges an entry (0 = purges within the day). */
function daysLeft(deletedAt: number): number {
  const ms = deletedAt + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000 - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

function TrashFolder({
  entries,
  open,
  onToggle,
  onRestore,
  onPurge,
  onEmpty,
  onOpen,
}: {
  entries: TrashEntry[]
  open: boolean
  onToggle: () => void
  onRestore?: (id: string) => void
  onPurge?: (id: string) => void
  onEmpty?: () => void
  onOpen?: (entry: TrashEntry) => void
}) {
  return (
    <div className="mt-1">
      <div className={`group/trash flex items-center pr-1.5 transition hover:bg-surface-2 ${ROW_BLEED}`}>
        <button
          type="button"
          aria-label={open ? 'Collapse trash' : 'Expand trash'}
          aria-expanded={open}
          onClick={onToggle}
          className="relative flex shrink-0 items-center self-stretch pl-1.5 pr-1.5 text-text-muted hover:text-text-primary"
        >
          {open && (
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-[14px] top-[calc(50%+10px)] w-px bg-border-default/70"
            />
          )}
          <TrashIcon />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[15px] text-text-secondary"
        >
          <span className="truncate font-medium">Trash</span>
          {entries.length > 0 && (
            <span className="shrink-0 text-[11px] font-semibold text-text-muted">{entries.length}</span>
          )}
        </button>
        <RowMenu
          selected={false}
          hoverClass="group-hover/trash:opacity-100"
          items={
            onEmpty && entries.length > 0
              ? [{ label: 'Empty trash', icon: <TrashIcon />, danger: true, onClick: onEmpty }]
              : []
          }
        />
      </div>
      <Branch open={open}>
        <div className={`ctx-branch ${CHILD_INDENT}`}>
          {entries.length === 0 ? (
            <div className="py-1.5 pl-3 text-[13px] text-text-muted">Trash is empty.</div>
          ) : (
            entries.map((entry, i) => (
              <TrashRow
                key={entry.id}
                entry={entry}
                guide={i === entries.length - 1 ? 'last' : 'mid'}
                onRestore={onRestore}
                onPurge={onPurge}
                onOpen={onOpen}
              />
            ))
          )}
          {entries.length > 0 && (
            <div className="py-1 pl-3 text-[11px] text-text-muted">
              Deleted notes are removed for good after {TRASH_RETENTION_DAYS} days.
            </div>
          )}
        </div>
      </Branch>
    </div>
  )
}

function TrashRow({
  entry,
  guide,
  onRestore,
  onPurge,
  onOpen,
}: {
  entry: TrashEntry
  guide: Guide
  onRestore?: (id: string) => void
  onPurge?: (id: string) => void
  onOpen?: (entry: TrashEntry) => void
}) {
  const left = daysLeft(entry.deletedAt)
  // The row opens a READ-ONLY preview rather than the note itself: the note is
  // soft-deleted, so there is no live path to route to, but its content is all
  // still there, and "what was in it?" is the question you have to answer
  // before you can choose between Restore and Delete forever.
  const label = (
    <>
      <span className="shrink-0 text-text-muted">
        <FileIcon />
      </span>
      <span className="truncate text-text-secondary">{entry.title || entry.name}</span>
      <span className="shrink-0 text-[11px] text-text-muted">
        {left === 0 ? 'today' : `${left}d`}
      </span>
    </>
  )
  return (
    <div className={`group flex items-center pr-1.5 transition hover:bg-surface-2 ${ROW_BLEED}`}>
      <GuideLine guide={guide} />
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(entry)}
          title={entry.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left text-[15px]"
        >
          {label}
        </button>
      ) : (
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-[15px]"
          title={entry.path}
        >
          {label}
        </div>
      )}
      <RowMenu
        selected={false}
        items={[
          ...(onOpen ? [{ label: 'Preview', icon: <FileIcon />, onClick: () => onOpen(entry) }] : []),
          ...(onRestore ? [{ label: 'Restore', icon: <RestoreIcon />, onClick: () => onRestore(entry.id) }] : []),
          ...(onPurge
            ? [{ label: 'Delete forever', icon: <TrashIcon />, danger: true, onClick: () => onPurge(entry.id) }]
            : []),
        ]}
      />
    </div>
  )
}

function Tree({
  node,
  openPaths,
  onToggleFolder,
  onOpenFolder,
  selectedPath,
  starredSet,
  glyphFor,
  canEdit,
  onSelect,
  onToggleStar,
  onDeleteNote,
  folderBadges,
  onFolderAccess,
  onShareNote,
  onDeleteFolder,
}: {
  node: TreeNode
  openPaths: Set<string>
  onToggleFolder: (path: string, isOpen: boolean) => void
  onOpenFolder: (path: string) => void
  selectedPath: string | null
  starredSet: Set<string>
  glyphFor: Map<string, NodeGlyph>
  canEdit: boolean
  onSelect: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onDeleteNote: (path: string) => void
  folderBadges?: Map<string, FolderBadge>
  onFolderAccess?: (folderId: string) => void
  onShareNote?: (path: string) => void
  onDeleteFolder?: (folderPath: string, label?: string) => void
}) {
  // A folder's own index.md never renders as a child row â€” the folder row IS
  // the index (clicking the folder name opens it; see FolderRow). The context
  // root included: its index.md folds into the root folder row, so the
  // space reads as the parent folder of everything below it.
  const ownIndex = node.path ? `${node.path}/index.md` : 'index.md'
  const children = (node.children ?? []).filter(
    (c) => !(c.kind === 'note' && c.path === ownIndex),
  )
  return (
    <>
      {children.map((child, i) =>
        child.kind === 'folder' ? (
          <FolderRow
            key={child.path}
            node={child}
            guide={i === children.length - 1 ? 'last' : 'mid'}
            guideActive={onSelectedPath(child.path, selectedPath)}
            openPaths={openPaths}
            onToggleFolder={onToggleFolder}
            onOpenFolder={onOpenFolder}
            selectedPath={selectedPath}
            starredSet={starredSet}
            glyphFor={glyphFor}
            canEdit={canEdit}
            onSelect={onSelect}
            onToggleStar={onToggleStar}
            onDeleteNote={onDeleteNote}
            folderBadges={folderBadges}
            onFolderAccess={onFolderAccess}
            onShareNote={onShareNote}
            onDeleteFolder={onDeleteFolder}
          />
        ) : (
          <NoteRow
            key={child.path}
            title={child.title ?? child.name}
            path={child.path}
            guide={i === children.length - 1 ? 'last' : 'mid'}
            guideActive={selectedPath === child.path}
            glyph={glyphFor.get(child.path) ?? null}
            selected={selectedPath === child.path}
            starred={starredSet.has(child.path)}
            restrictedBadge={folderBadges?.get(child.path)?.restricted ?? false}
            canEdit={canEdit}
            onSelect={onSelect}
            onToggleStar={onToggleStar}
            onDelete={onDeleteNote}
            onShare={onShareNote}
          />
        ),
      )}
    </>
  )
}

function FolderRow(props: {
  node: TreeNode
  /** Tree guide for a nested row; omitted for the tree's root folder row. */
  guide?: Guide
  /** The open note is this folder or lives inside it â€” tints the guide. */
  guideActive?: boolean
  /** Overrides the folder's own name (used for the context-root row). */
  label?: string
  /** Overrides the folder glyph; explicit null renders no glyph (the root row). */
  icon?: React.ReactNode | null
  openPaths: Set<string>
  onToggleFolder: (path: string, isOpen: boolean) => void
  onOpenFolder: (path: string) => void
  selectedPath: string | null
  starredSet: Set<string>
  glyphFor: Map<string, NodeGlyph>
  canEdit: boolean
  onSelect: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onDeleteNote: (path: string) => void
  folderBadges?: Map<string, FolderBadge>
  onFolderAccess?: (folderId: string) => void
  onShareNote?: (path: string) => void
  onDeleteFolder?: (folderPath: string, label?: string) => void
}) {
  // Expansion is owned by NoteSidebar (persisted, and revealed by selection) â€”
  // this row only reads it and reports toggles.
  const open = props.openPaths.has(props.node.path)
  const setOpen = () => props.onToggleFolder(props.node.path, open)
  // Grants live at any depth now, so every folder row can carry a badge and a
  // Share affordance (keyed by the folder's full path).
  const badge = props.folderBadges?.get(props.node.path)
  const showAccess = !!props.onFolderAccess
  // Folder-note behaviour: when the folder has an index.md (hidden as a child
  // row by Tree), the folder row IS that note â€” clicking the name opens it and
  // selection highlights here. The chevron keeps expand/collapse to itself.
  // The context root works the same way over its own index.md, so the space
  // row opens the space's home note.
  // The folder's display name: an explicit label (the context root's), else the
  // title its index note declares, else the path segment.
  const folderLabel = props.label ?? props.node.title ?? props.node.name
  const indexPath = props.node.path ? `${props.node.path}/index.md` : 'index.md'
  const hasIndex = (props.node.children ?? []).some((c) => c.kind === 'note' && c.path === indexPath)
  const selected = hasIndex && props.selectedPath === indexPath

  // Moving: a folder row is both a drag source (its whole subtree travels with
  // it) and the tree's only drop target - notes and folders are filed INTO
  // folders, never next to a note. The context root row is the target for "top
  // level"; it is never a source.
  const drag = useContext(TreeDrag)
  const item: MovableItem = { path: props.node.path, kind: 'folder', label: folderLabel }
  const draggable = !!drag && !!props.node.path && isMovable(props.node.path, 'folder')
  const isDragged = drag?.dragging?.path === props.node.path
  const accepts = !!drag?.dragging && canMoveInto(drag.dragging.path, drag.dragging.kind, props.node.path)
  const isDropTarget = accepts && drag?.dropFolder === props.node.path
  // Hovering a shut folder mid-drag springs it open, so a note can be dropped
  // into a nested folder without letting go first.
  const springRef = useRef<number | null>(null)
  const cancelSpring = () => {
    if (springRef.current !== null) {
      window.clearTimeout(springRef.current)
      springRef.current = null
    }
  }
  useEffect(() => cancelSpring, [])

  return (
    <div>
      <div
        draggable={draggable}
        onDragStart={(e) => {
          if (!draggable) return
          e.dataTransfer.setData('text/plain', props.node.path)
          e.dataTransfer.effectAllowed = 'move'
          drag!.begin(item)
        }}
        onDragEnd={() => {
          cancelSpring()
          drag?.end()
        }}
        onDragOver={(e) => {
          if (!accepts) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          if (drag!.dropFolder !== props.node.path) drag!.hover(props.node.path)
          if (!open && springRef.current === null) {
            springRef.current = window.setTimeout(() => {
              springRef.current = null
              props.onOpenFolder(props.node.path)
            }, 600)
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          cancelSpring()
          if (drag?.dropFolder === props.node.path) drag.hover(null)
        }}
        onDrop={(e) => {
          if (!accepts) return
          e.preventDefault()
          e.stopPropagation()
          cancelSpring()
          const dragged = drag!.dragging!
          drag!.end()
          drag!.move(dragged, props.node.path)
        }}
        className={`group/folder flex items-center pr-1.5 transition ${ROW_BLEED} ${
          selected ? 'bg-brand-green/15' : 'hover:bg-surface-2'
        } ${isDragged ? 'opacity-50' : ''} ${
          isDropTarget ? 'bg-brand-green/15 ring-1 ring-inset ring-brand-green' : ''
        }`}
      >
        {props.guide && <GuideLine guide={props.guide} active={props.guideActive} />}
        {/* The folder glyph is the expand/collapse control â€” open vs shut is
            the icon itself, so the row needs no chevron beside the guide lines.
            self-stretch, not py-*: the row is as tall as the label button's
            15px line-box (~35px) while the icon's own content is 16px, so
            items-center leaves a ~3px dead strip above and below it where clicks
            land on the row div and nothing expands. Stretching makes the target
            the full row height. */}
        <button
          type="button"
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
          aria-expanded={open}
          onClick={() => setOpen()}
          className={`relative flex shrink-0 items-center self-stretch pl-1.5 pr-1.5 ${
            selected ? 'text-brand-green' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          {/* The stem: an open folder's children hang off a line that drops
              from this glyph rather than starting in mid-air below it. It
              begins just under the 16px glyph's bottom edge (half the row +
              8px + a hair of air) so it never draws through the icon, and sits
              at the glyph's centre â€” exactly where CHILD_INDENT puts the
              children's guides, so the two read as one line. */}
          {open && (
            <span
              aria-hidden="true"
              className={`absolute bottom-0 left-[14px] top-[calc(50%+10px)] w-px ${
                onSelectedPath(props.node.path, props.selectedPath)
                  ? 'bg-brand-green/60'
                  : 'bg-border-default/70'
              }`}
            />
          )}
          {props.icon ?? <FolderIcon open={open} />}
        </button>
        <button
          type="button"
          onClick={() => {
            // Opening a folder's home note expands the folder too — and does it
            // HERE, on the click, rather than waiting for the reveal that the
            // new route feeds back down. That round trip is a navigation long,
            // and the folder sitting shut for it is what read as lag.
            if (!hasIndex) return setOpen()
            // Clicking the name of the folder whose note is ALREADY open is a
            // collapse: the note is on screen, so the only thing left to ask
            // for is to fold the branch away. Selection stays put.
            if (selected && open) return setOpen()
            // Otherwise pin it open rather than toggling: the row may already
            // LOOK open on a reveal it is about to lose — selecting the
            // folder's own note moves the reveal off whatever child chain was
            // holding it — and only a hand-opened entry survives that.
            props.onOpenFolder(props.node.path)
            props.onSelect(indexPath)
          }}
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[15px] ${
            selected ? 'text-text-primary' : 'text-text-secondary'
          }`}
        >
          <span className={`truncate font-medium ${selected ? 'font-semibold' : ''}`}>
            {folderLabel}
          </span>
          {badge?.restricted && (
            <span className="shrink-0 text-text-muted" title="Restricted folder â€” access is granted here, not inherited">
              <LockIcon />
            </span>
          )}
          {badge?.level && (
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {badge.level}
            </span>
          )}
        </button>
        <RowMenu
          selected={selected}
          hoverClass="group-hover/folder:opacity-100"
          items={[
            ...(showAccess
              ? [{ label: 'Share', icon: <ShareIcon />, onClick: () => props.onFolderAccess!(props.node.path) }]
              : []),
            // No Star: a folder IS its index note, and index notes aren't
            // starrable â€” Starred is a shortcut list of notes, not folders.
            ...(draggable
              ? [{ label: 'Move to...', icon: <MoveIcon />, onClick: () => drag!.requestMove(item) }]
              : []),
            // No Delete on the root (that row is the context itself), nor on a
            // built-in folder: agents/, connectors/, tools/, people/ and the
            // rest are structure the runtime resolves against, so the row
            // offers no way to remove one (deleteFolderDenial).
            ...(props.onDeleteFolder && !deleteFolderDenial(props.node.path)
              ? [
                  {
                    label: 'Delete',
                    icon: <TrashIcon />,
                    danger: true,
                    onClick: () => props.onDeleteFolder!(props.node.path, folderLabel),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <Branch open={open}>
        {/* Indented child container; each child row draws its own guide. The
            wrapper continues THIS row's own guide down past the subtree:
            without it the parent level's line breaks every time a folder is
            expanded, leaving a gap between the folder and its next sibling. */}
        <div className="relative">
          {props.guide === 'mid' && (
            <span
              aria-hidden="true"
              className={`absolute bottom-0 left-0 top-0 w-px ${
                props.guideActive ? 'bg-brand-green/60' : 'bg-border-default/70'
              }`}
            />
          )}
          <div className={`ctx-branch ${props.guide ? NESTED_CHILD_INDENT : CHILD_INDENT}`}>
            <Tree
              node={props.node}
              openPaths={props.openPaths}
              onToggleFolder={props.onToggleFolder}
              onOpenFolder={props.onOpenFolder}
              selectedPath={props.selectedPath}
              starredSet={props.starredSet}
              glyphFor={props.glyphFor}
              canEdit={props.canEdit}
              onSelect={props.onSelect}
              onToggleStar={props.onToggleStar}
              onDeleteNote={props.onDeleteNote}
              folderBadges={props.folderBadges}
              onFolderAccess={props.onFolderAccess}
              onShareNote={props.onShareNote}
              onDeleteFolder={props.onDeleteFolder}
            />
          </div>
        </div>
      </Branch>
    </div>
  )
}

// â”€â”€ Row action menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface RowMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
}

const ROW_MENU_W = 160
const ROW_MENU_ITEM_H = 34

/** The â‹¯ button every row shows on hover, opening its actions (star, delete,
 *  shareâ€¦) in a small popup. The popup is a fixed-position portal: the tree's
 *  scroll container clips overflow on both axes, so an absolutely positioned
 *  menu inside the row would be cut off at the panel edge. Fixed positioning
 *  detaches from scrolling, so any scroll just closes the menu. */
function RowMenu({
  items,
  selected,
  hoverClass = 'group-hover:opacity-100',
}: {
  items: RowMenuItem[]
  selected: boolean
  /** The row's hover-group variant that reveals the trigger. */
  hoverClass?: string
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const close = useCallback(() => setPos(null), [])

  const toggle = () => {
    if (pos) return close()
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const height = items.length * ROW_MENU_ITEM_H + 10
    const openUp = r.bottom + height + 8 > window.innerHeight
    setPos({
      top: openUp ? r.top - height - 4 : r.bottom + 4,
      left: Math.max(8, r.right - ROW_MENU_W),
    })
  }

  useEffect(() => {
    if (!pos) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pos, close])

  if (items.length === 0) return null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={toggle}
        className={`shrink-0 rounded p-1 transition ${
          selected ? 'text-text-secondary hover:text-text-primary' : 'text-text-muted hover:text-text-secondary'
        } ${pos ? 'opacity-100' : `opacity-0 ${hoverClass}`}`}
      >
        <KebabIcon />
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="dropdown-pop fixed z-[100] rounded-xl border border-border-subtle bg-surface-1 py-[5px] shadow-float"
            style={{ top: pos.top, left: pos.left, width: ROW_MENU_W }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  close()
                  item.onClick()
                }}
                className={`flex w-full items-center gap-2 px-3 text-left text-[13px] transition-colors hover:bg-surface-2 ${
                  item.danger ? 'text-red-500' : 'text-text-secondary'
                }`}
                style={{ height: ROW_MENU_ITEM_H }}
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

function NoteRow({
  title,
  path,
  glyph,
  guide,
  guideActive,
  selected,
  starred,
  restrictedBadge = false,
  canEdit,
  onSelect,
  onToggleStar,
  onDelete,
  onShare,
}: {
  title: string
  path: string
  glyph: NodeGlyph | null
  /** Tree guide for a nested row; omitted for the flat Starred list. */
  guide?: Guide
  guideActive?: boolean
  selected: boolean
  starred: boolean
  /** The note is privately restricted â€” inherited access is cut at the note. */
  restrictedBadge?: boolean
  canEdit: boolean
  onSelect: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onDelete: (path: string) => void
  onShare?: (path: string) => void
}) {
  const drag = useContext(TreeDrag)
  const item: MovableItem = { path, kind: 'note', label: title }
  const draggable = !!drag && isMovable(path, 'note')
  const isDragged = drag?.dragging?.path === path
  return (
    <div
      data-note-path={path}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return
        // text/plain keeps the drag valid for the browser's own machinery (and
        // shows the path if it ever lands outside the tree).
        e.dataTransfer.setData('text/plain', path)
        e.dataTransfer.effectAllowed = 'move'
        drag!.begin(item)
      }}
      onDragEnd={() => drag?.end()}
      className={`group flex items-center pr-1.5 transition ${ROW_BLEED} ${
        selected ? 'bg-brand-green/15' : 'hover:bg-surface-2'
      } ${isDragged ? 'opacity-50' : ''}`}
    >
      {guide && <GuideLine guide={guide} active={guideActive} />}
      <button
        type="button"
        onClick={() => onSelect(path)}
        className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[15px] ${
          // Notes carry no chevron, so the icon is padded across to sit under
          // the folder icons above it.
          guide ? 'pl-1.5' : 'pl-2'
        }`}
      >
        <span className={`shrink-0 ${selected ? 'text-brand-green' : 'text-text-muted'}`}>
          {glyph ? <GlyphIcon glyph={glyph} /> : <FileIcon />}
        </span>
        <span className={`truncate ${selected ? 'font-semibold text-text-primary' : 'text-text-primary'}`}>
          {title}
        </span>
        {restrictedBadge && (
          <span
            className={`shrink-0 ${selected ? 'text-brand-green' : 'text-text-muted'}`}
            title="Private note â€” access from its folders is cut off"
          >
            <LockIcon />
          </span>
        )}
      </button>
      <RowMenu
        selected={selected}
        items={[
          ...(onShare
            ? [{ label: 'Share', icon: <ShareIcon />, onClick: () => onShare(path) }]
            : []),
          // Index notes are folders, and folders aren't starrable.
          ...(isIndexPath(path)
            ? []
            : [{
                label: starred ? 'Unstar' : 'Star',
                icon: <StarIcon filled={starred} />,
                onClick: () => onToggleStar(path, !starred),
              }]),
          ...(draggable
            ? [{ label: 'Move to...', icon: <MoveIcon />, onClick: () => drag!.requestMove(item) }]
            : []),
          ...(canEdit
            ? [{ label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => onDelete(path) }]
            : []),
        ]}
      />
    </div>
  )
}

// -- Move to... dialog --------------------------------------------------------

interface FolderChoice {
  path: string
  label: string
  depth: number
}

/** Every folder in the tree, depth-first, so the list reads in tree order. */
function collectFolders(node: TreeNode, out: FolderChoice[], depth = 0): void {
  for (const child of node.children ?? []) {
    if (child.kind !== 'folder') continue
    out.push({ path: child.path, label: child.title ?? child.name, depth })
    collectFolders(child, out, depth + 1)
  }
}

/**
 * The pointer-free half of moving: pick the destination folder from a filtered
 * list. Folders the item can't go into stay visible but disabled, with the
 * reason on hover - a managed entity namespace should read as "not here",
 * not vanish from the tree the user is looking at.
 */
function MoveDialog({
  item,
  tree,
  rootLabel,
  onClose,
  onPick,
}: {
  item: MovableItem
  tree: TreeNode
  rootLabel: string
  onClose: () => void
  onPick: (destFolder: string) => void
}) {
  const [query, setQuery] = useState('')
  const folders = useMemo(() => {
    const out: FolderChoice[] = [{ path: '', label: rootLabel, depth: 0 }]
    collectFolders(tree, out)
    return out
  }, [tree, rootLabel])

  const q = query.trim().toLowerCase()
  const shown = q
    ? folders.filter((f) => f.label.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
    : folders

  return (
    <Modal onClose={onClose} size="sm" title={`Move “${item.label}”`}>
      <div className="flex flex-col gap-3">
        <input
          autoFocus
          className={inputBaseClass}
          placeholder="Filter folders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border-default">
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-sm text-text-muted">No folder matches “{query}”.</p>
          ) : (
            shown.map((folder) => {
              const allowed = canMoveInto(item.path, item.kind, folder.path)
              const reason =
                moveDenial(item.path, item.kind, folder.path) ??
                (allowed ? undefined : 'It is already here.')
              return (
                <button
                  key={folder.path || '<root>'}
                  type="button"
                  disabled={!allowed}
                  title={reason}
                  onClick={() => onPick(folder.path)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    allowed
                      ? 'text-text-primary hover:bg-surface-2'
                      : 'cursor-not-allowed text-text-muted'
                  }`}
                  // Search flattens the tree, so indentation only means depth
                  // while the full list is showing.
                  style={{ paddingLeft: q ? undefined : 12 + folder.depth * 14 }}
                >
                  <span className="shrink-0 text-text-muted">
                    <FolderIcon />
                  </span>
                  <span className="truncate">{folder.label}</span>
                  {folder.path && (
                    <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-text-muted">
                      {folder.path}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </Modal>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{children}</div>
  )
}

function FolderIcon({ open = false }: { open?: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

// Type glyph (person/group/event/resource silhouette) sized to match FileIcon.
function GlyphIcon({ glyph }: { glyph: NodeGlyph }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={NODE_GLYPH_PATHS[glyph]} />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  )
}

function StarIcon({ filled = false }: { filled?: boolean }) {
  // Same star glyph as the editor toolbar's lucide Star; fills amber when starred.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  )
}

// Horizontal â‹¯ â€” the rows' single actions trigger.
function KebabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  )
}

// Folder-with-arrow (lucide FolderInput) - the rows' "Move to..." action.
function MoveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2" />
      <path d="M2 13h10" />
      <path d="m9 16 3-3-3-3" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

// Share glyph (same shape as the editor toolbar's lucide Share2).
function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </svg>
  )
}

// Counter-clockwise arrow (lucide RotateCcw) â€” the trash rows' Restore action.
function RestoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  )
}
