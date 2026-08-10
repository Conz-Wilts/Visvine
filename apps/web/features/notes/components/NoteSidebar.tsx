'use client'

// The notes sidebar: starred notes and a folder/note tree. Folders expand/collapse
// and carry a folder icon; notes carry their frontmatter type's glyph (person,
// group, event, resource) or a document icon when untyped. Row actions (star,
// delete, share) live behind a single ⋯ menu revealed on hover — starred state
// shows only there and in the Starred section above the tree, never as a glyph
// on the row. Starring is the same `starred:` frontmatter flag the editor
// toolbar's star toggles, so both surfaces always agree. Nesting is shown
// VS Code style: each level is wrapped in an indented container with a left guide
// line so folder depth reads at a glance. The tree scrolls with its scrollbar on
// the right (normal) edge. A Trash folder is pinned below everything: deleted
// notes live there for a week (restore or delete-forever from the row menu)
// before the server purges them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NoteMeta, TreeNode, TrashEntry } from '@/lib/notes/shared/types'
import { TRASH_RETENTION_DAYS } from '@/lib/notes/shared/types'
import { getNodeGlyph } from '@/lib/types'
import { NODE_GLYPH_PATHS, type NodeGlyph } from '@/lib/avatarUtils'
import { entityKindOf } from '@/lib/notes/entities'
import { isIndexPath } from '@/lib/notes/shared/indexNote'
import { TRASH_PATH, useContextTreeState } from '@/features/notes/hooks/useContextTreeState'

// Expansion state (openPaths + reveal overlay + persistence) lives in
// useContextTreeState, shared with the full-screen Context explorer so both
// surfaces read and write the same per-community blob.
// VS Code-style row band: the hover/selection background runs the FULL panel
// width, square-edged, regardless of how deeply the row is nested. Rows sit
// inside per-level indent containers, so the depth offset isn't knowable here —
// instead the row box is pulled far to the left and given matching padding
// back, which leaves its content exactly where it was and lets the background
// (and the guide lines it covers) bleed out to the panel edge. The scroll
// container clips the overhang with overflow-x-hidden.
const ROW_BLEED = '-ml-[999px] pl-[999px]'

// Where the tree was scrolled to, per scope, kept for the lifetime of the tab.
// The docked tree re-mounts on every navigation (each page renders its own
// ContextSidebar), and a fresh scroll container starts at 0 — so clicking a note
// half-way down the tree would snap the list to the top and then smooth-scroll
// back. Restoring the offset on mount makes the swap invisible.
const scrollMemory = new Map<string, number>()

// The glyph for a note's frontmatter type. `entityKindOf` is the wider net —
// it catches retired organisation spellings getNodeGlyph has no entry for — so
// those notes still read as the cluster glyph rather than falling back to
// initials.
export function noteGlyph(type: string | undefined): NodeGlyph | null {
  return getNodeGlyph(type) ?? (entityKindOf(type) === 'community' ? 'group' : null)
}

/** Access adornments for a folder row at ANY depth (shared brain only):
 *  restricted = a grant boundary (🔒), plus the viewer's own level chip. */
interface FolderBadge {
  restricted: boolean
  locked?: boolean
  /** The viewer's own effective level at the folder ('view'…'full'). */
  level?: string
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
  /** Access badges keyed by FULL path — folders AND privately-restricted notes
   *  (shared scope only). */
  folderBadges?: Map<string, FolderBadge>
  /** Hover action on folder rows: open the folder's Share panel. */
  onFolderAccess?: (folderPath: string) => void
  /** ⋯ menu action on note rows: open the note's Share panel. */
  onShareNote?: (path: string) => void
  /** ⋯ menu action on folder rows: delete the folder (and the notes inside). */
  onDeleteFolder?: (folderPath: string, label?: string) => void
  /** Render without card chrome (bg/border/shadow) — used when the sidebar sits on
   *  the shared dock backdrop, which already supplies the background and shadow. */
  bare?: boolean
  /** Show the brain root as a real (collapsible) folder row at the top of the
   *  tree instead of a separate header bar, so the community reads as the parent
   *  folder of everything below it. `icon` replaces the folder glyph; the root
   *  row shows no glyph at all when it's omitted. */
  root?: { label: string; icon?: React.ReactNode }
  /** Scopes the persisted expand/collapse state (pass the community id). Omit to
   *  keep the state in memory only. */
  storageKey?: string | null
  /** Soft-deleted notes for this brain, shown as a Trash folder pinned to the
   *  bottom of the tree. Omit (or pass null) to hide the row entirely. */
  trash?: TrashEntry[] | null
  /** Trash row actions. Restore puts the note back at its original path;
   *  purge/empty delete permanently, ahead of the retention window. */
  onRestoreTrash?: (id: string) => void
  onPurgeTrash?: (id: string) => void
  onEmptyTrash?: () => void
  /** Note to temporarily expand the tree down to (the context search's focused
   *  match, or the note a profile page has open). Unlike a click this never
   *  changes the saved expansion — clearing it collapses the peek back to
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
  trash = null,
  onRestoreTrash,
  onPurgeTrash,
  onEmptyTrash,
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

  // Which folders are expanded — persisted per scope, with the reveal peek
  // layered on top (see useContextTreeState for the full story).
  const { effectiveOpenPaths, toggleFolder } = useContextTreeState(storageKey, revealPath)

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
    <div
      className={`flex h-full flex-col overflow-hidden ${
        /* bare = docked into the square-cornered Sidebar card — rounding here
           would carve a curved clip into the card's top edge by the scrollbar */
        bare ? '' : 'rounded-l-none rounded-r-2xl border border-border-default bg-surface-1 shadow-float'
      }`}
    >
      {/* overscroll-contain: hitting either end of the tree must not chain the
          wheel out to the page behind it (on the Context views that reads as the
          graph jumping while you scroll the tree). */}
      {/* overflow-x-hidden clips ROW_BLEED's overhang (overflow-y-auto alone
          would resolve x to auto and show a horizontal scrollbar). No px here:
          the row bands must reach both panel edges — rows carry their own
          inner padding. */}
      <div
        ref={scrollRef}
        onScroll={rememberScroll}
        className="scrollbar-on-hover flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-3"
      >
        {/* pl only — it insets the row CONTENT off the panel edge while the
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
            // The brain root as the tree's own top-level folder — same row
            // chrome as any other folder, so nesting reads uniformly from the
            // community down.
            <FolderRow
              node={tree}
              label={root.label}
              icon={root.icon ?? null}
              openPaths={effectiveOpenPaths}
              onToggleFolder={toggleFolder}
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

          {/* Trash sits at the very bottom of every brain, below the whole tree
              — a folder-shaped row rather than a modal, so restoring reads as
              moving a note back rather than a separate admin surface. */}
          {trash && (
            <TrashFolder
              entries={trash}
              open={effectiveOpenPaths.has(TRASH_PATH)}
              onToggle={() => toggleFolder(TRASH_PATH, effectiveOpenPaths.has(TRASH_PATH))}
              onRestore={onRestoreTrash}
              onPurge={onPurgeTrash}
              onEmpty={onEmptyTrash}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Trash ─────────────────────────────────────────────────────────────────────

/** Whole days left before the server purges an entry (0 = purges within the day). */
export function daysLeft(deletedAt: number): number {
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
}: {
  entries: TrashEntry[]
  open: boolean
  onToggle: () => void
  onRestore?: (id: string) => void
  onPurge?: (id: string) => void
  onEmpty?: () => void
}) {
  return (
    <div className="mt-1">
      <div className={`group/trash flex items-center pr-1.5 transition hover:bg-surface-2 ${ROW_BLEED}`}>
        <button
          type="button"
          aria-label={open ? 'Collapse trash' : 'Expand trash'}
          onClick={onToggle}
          className="shrink-0 py-1.5 pl-1 pr-0.5 text-text-secondary hover:text-text-primary"
        >
          <Chevron open={open} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left text-[15px] text-text-secondary"
        >
          <span className="shrink-0 text-text-muted">
            <TrashIcon />
          </span>
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
      {open && (
        <div className="ml-[15px] border-l border-border-default/70 pl-[2px]">
          {entries.length === 0 ? (
            <div className="py-1.5 pl-3 text-[13px] text-text-muted">Trash is empty.</div>
          ) : (
            entries.map((entry) => (
              <TrashRow
                key={entry.id}
                entry={entry}
                onRestore={onRestore}
                onPurge={onPurge}
              />
            ))
          )}
          {entries.length > 0 && (
            <div className="py-1 pl-3 text-[11px] text-text-muted">
              Deleted notes are removed for good after {TRASH_RETENTION_DAYS} days.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TrashRow({
  entry,
  onRestore,
  onPurge,
}: {
  entry: TrashEntry
  onRestore?: (id: string) => void
  onPurge?: (id: string) => void
}) {
  const left = daysLeft(entry.deletedAt)
  return (
    <div className={`group flex items-center pr-1.5 transition hover:bg-surface-2 ${ROW_BLEED}`}>
      {/* A trashed note has nothing to open — the row is a label, and the ⋯ menu
          carries the only two things you can do with it. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-[15px]" title={entry.path}>
        <span className="shrink-0 text-text-muted">
          <FileIcon />
        </span>
        <span className="truncate text-text-secondary">{entry.name}</span>
        <span className="shrink-0 text-[11px] text-text-muted">
          {left === 0 ? 'today' : `${left}d`}
        </span>
      </div>
      <RowMenu
        selected={false}
        items={[
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
  // A folder's own index.md never renders as a child row — the folder row IS
  // the index (clicking the folder name opens it; see FolderRow). The brain
  // root included: its index.md folds into the root folder row, so the
  // community reads as the parent folder of everything below it.
  const ownIndex = node.path ? `${node.path}/index.md` : 'index.md'
  const children = (node.children ?? []).filter(
    (c) => !(c.kind === 'note' && c.path === ownIndex),
  )
  return (
    <>
      {children.map((child) =>
        child.kind === 'folder' ? (
          <FolderRow
            key={child.path}
            node={child}
            openPaths={openPaths}
            onToggleFolder={onToggleFolder}
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
  /** Overrides the folder's own name (used for the brain-root row). */
  label?: string
  /** Overrides the folder glyph; explicit null renders no glyph (the root row). */
  icon?: React.ReactNode | null
  openPaths: Set<string>
  onToggleFolder: (path: string, isOpen: boolean) => void
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
  // Expansion is owned by NoteSidebar (persisted, and revealed by selection) —
  // this row only reads it and reports toggles.
  const open = props.openPaths.has(props.node.path)
  const setOpen = () => props.onToggleFolder(props.node.path, open)
  // Grants live at any depth now, so every folder row can carry a badge and a
  // Share affordance (keyed by the folder's full path).
  const badge = props.folderBadges?.get(props.node.path)
  const showAccess = !!props.onFolderAccess
  // Folder-note behaviour: when the folder has an index.md (hidden as a child
  // row by Tree), the folder row IS that note — clicking the name opens it and
  // selection highlights here. The chevron keeps expand/collapse to itself.
  // The brain root works the same way over its own index.md, so the community
  // row opens the community's home note.
  // The folder's display name: an explicit label (the brain root's), else the
  // title its index note declares, else the path segment.
  const folderLabel = props.label ?? props.node.title ?? props.node.name
  const indexPath = props.node.path ? `${props.node.path}/index.md` : 'index.md'
  const hasIndex = (props.node.children ?? []).some((c) => c.kind === 'note' && c.path === indexPath)
  const selected = hasIndex && props.selectedPath === indexPath
  return (
    <div>
      <div
        className={`group/folder flex items-center pr-1.5 transition ${ROW_BLEED} ${
          selected ? 'bg-brand-green' : 'hover:bg-surface-2'
        }`}
      >
        <button
          type="button"
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
          onClick={() => setOpen()}
          className={`shrink-0 py-1.5 pl-1 pr-0.5 ${
            selected ? 'text-white' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Chevron open={open} />
        </button>
        <button
          type="button"
          onClick={() => (hasIndex ? props.onSelect(indexPath) : setOpen())}
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left text-[15px] ${
            selected ? 'text-white' : 'text-text-secondary'
          }`}
        >
          {props.icon !== null && (
            <span className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}>
              {props.icon ?? <FolderIcon open={open} />}
            </span>
          )}
          <span className={`truncate font-medium ${selected ? 'font-semibold' : ''}`}>
            {folderLabel}
          </span>
          {badge?.restricted && (
            <span className="shrink-0 text-text-muted" title="Restricted folder — access is granted here, not inherited">
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
            // starrable — Starred is a shortcut list of notes, not folders.
            // The root row is the brain itself — not deletable from the tree.
            ...(props.onDeleteFolder && props.node.path !== ''
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
      {open && (
        // Indented child container with a left guide line (VS Code style).
        <div className="ml-[15px] border-l border-border-default/70 pl-[2px]">
          <Tree
            node={props.node}
            openPaths={props.openPaths}
            onToggleFolder={props.onToggleFolder}
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
      )}
    </div>
  )
}

// ── Row action menu ───────────────────────────────────────────────────────────

export interface RowMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
}

const ROW_MENU_W = 160
const ROW_MENU_ITEM_H = 34

/** The ⋯ button every row shows on hover, opening its actions (star, delete,
 *  share…) in a small popup. The popup is a fixed-position portal: the tree's
 *  scroll container clips overflow on both axes, so an absolutely positioned
 *  menu inside the row would be cut off at the panel edge. Fixed positioning
 *  detaches from scrolling, so any scroll just closes the menu. */
export function RowMenu({
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
          selected ? 'text-white' : 'text-text-muted hover:text-text-secondary'
        } ${pos ? 'opacity-100' : `opacity-0 ${hoverClass}`}`}
      >
        <KebabIcon />
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="dropdown-pop fixed z-[100] rounded-xl border border-border-subtle bg-surface-1 py-[5px] shadow-xl"
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
  selected: boolean
  starred: boolean
  /** The note is privately restricted — inherited access is cut at the note. */
  restrictedBadge?: boolean
  canEdit: boolean
  onSelect: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onDelete: (path: string) => void
  onShare?: (path: string) => void
}) {
  return (
    <div
      data-note-path={path}
      className={`group flex items-center pr-1.5 transition ${ROW_BLEED} ${
        selected ? 'bg-brand-green' : 'hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(path)}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left text-[15px]"
      >
        <span className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}>
          {glyph ? <GlyphIcon glyph={glyph} /> : <FileIcon />}
        </span>
        <span className={`truncate ${selected ? 'font-semibold text-white' : 'text-text-primary'}`}>
          {title}
        </span>
        {restrictedBadge && (
          <span
            className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}
            title="Private note — access from its folders is cut off"
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
          ...(canEdit
            ? [{ label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => onDelete(path) }]
            : []),
        ]}
      />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{children}</div>
  )
}

// Expand/collapse chevron. A stroked SVG rather than the ▸/▾ text glyphs those
// render hairline-thin and sit off the row's optical centre at this size.
// Rotating one shape keeps the two states visually identical in weight, and
// animating the rotation shows which way the fold went.
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="block transition-transform duration-150"
      style={{ transform: open ? 'rotate(90deg)' : 'none' }}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function FolderIcon({ open = false }: { open?: boolean }) {
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
export function GlyphIcon({ glyph }: { glyph: NodeGlyph }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={NODE_GLYPH_PATHS[glyph]} />
    </svg>
  )
}

export function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  )
}

export function StarIcon({ filled = false }: { filled?: boolean }) {
  // Same star glyph as the editor toolbar's lucide Star; fills amber when starred.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  )
}

// Horizontal ⋯ — the rows' single actions trigger.
function KebabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  )
}

export function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

// Share glyph (same shape as the editor toolbar's lucide Share2).
export function ShareIcon() {
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

// Counter-clockwise arrow (lucide RotateCcw) — the trash rows' Restore action.
export function RestoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  )
}
