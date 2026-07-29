'use client'

// The notes sidebar: starred notes and a folder/note tree. Folders expand/collapse
// and carry a folder icon; notes carry their frontmatter type's glyph (person,
// group, event, resource) or a document icon when untyped. Note rows reveal star +
// delete actions on hover. Starring is the same `starred:` frontmatter flag the
// editor toolbar's star toggles, so both surfaces always agree. Nesting is shown
// VS Code style: each level is wrapped in an indented container with a left guide
// line so folder depth reads at a glance. The tree scrolls with its scrollbar on
// the right (normal) edge.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteMeta, TreeNode } from '@/lib/notes/shared/types'
import { getNodeGlyph } from '@/lib/types'
import { NODE_GLYPH_PATHS, type NodeGlyph } from '@/lib/avatarUtils'
import { entityKindOf } from '@/lib/notes/entities'

// Expansion state lives here (not per FolderRow) so it survives a folder row
// unmounting — collapsing a parent, or the panel remounting on navigation —
// and can be written back to localStorage as one blob. The tree opens fully
// COLLAPSED: a real brain has hundreds of entity notes, and an all-open tree
// buries the top-level structure under them. Only the root row (path '') starts
// open, otherwise the panel would read as empty.
// VS Code-style row band: the hover/selection background runs the FULL panel
// width, square-edged, regardless of how deeply the row is nested. Rows sit
// inside per-level indent containers, so the depth offset isn't knowable here —
// instead the row box is pulled far to the left and given matching padding
// back, which leaves its content exactly where it was and lets the background
// (and the guide lines it covers) bleed out to the panel edge. The scroll
// container clips the overhang with overflow-x-hidden.
const ROW_BLEED = '-ml-[999px] pl-[999px]'

const ROOT_PATH = ''
const OPEN_STORE_PREFIX = 'visvine:notes-tree-open:'

// Where the tree was scrolled to, per scope, kept for the lifetime of the tab.
// The docked tree re-mounts on every navigation (each page renders its own
// ContextSidebar), and a fresh scroll container starts at 0 — so clicking a note
// half-way down the tree would snap the list to the top and then smooth-scroll
// back. Restoring the offset on mount makes the swap invisible.
const scrollMemory = new Map<string, number>()

function readOpenPaths(storageKey: string | null): Set<string> {
  if (!storageKey || typeof window === 'undefined') return new Set([ROOT_PATH])
  try {
    const raw = window.localStorage.getItem(OPEN_STORE_PREFIX + storageKey)
    if (!raw) return new Set([ROOT_PATH])
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set([ROOT_PATH])
  } catch {
    return new Set([ROOT_PATH])
  }
}

/** Every folder path on the way down to `path` (so revealing a note opens its
 *  whole chain), including the root row. 'people/acme/index.md' → '', 'people',
 *  'people/acme'. */
function ancestorFolders(path: string): string[] {
  const parts = path.split('/')
  parts.pop() // the note's own filename
  const out = [ROOT_PATH]
  let acc = ''
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part
    out.push(acc)
  }
  return out
}

// The glyph for a note's frontmatter type. `entityKindOf` catches "company"
// (which getNodeGlyph doesn't know) so company notes read as the group glyph.
function noteGlyph(type: string | undefined): NodeGlyph | null {
  return getNodeGlyph(type) ?? (entityKindOf(type) === 'company' ? 'group' : null)
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
  /** Access badges keyed by FULL folder path (shared scope only). */
  folderBadges?: Map<string, FolderBadge>
  /** Hover action on folder rows: open the folder's Share panel. */
  onFolderAccess?: (folderPath: string) => void
  /** Render without card chrome (bg/border/shadow) — used when the sidebar sits on
   *  the shared dock backdrop, which already supplies the background and shadow. */
  bare?: boolean
  /** Show the brain root as a real (collapsible) folder row at the top of the
   *  tree instead of a separate header bar, so the community reads as the parent
   *  folder of everything below it. `icon` replaces the folder glyph. */
  root?: { label: string; icon?: React.ReactNode }
  /** Scopes the persisted expand/collapse state (pass the community id). Omit to
   *  keep the state in memory only. */
  storageKey?: string | null
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

  // Which folders are expanded, restored from the last visit for this scope.
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => readOpenPaths(storageKey))

  // Re-read when the scope changes (switching communities swaps the whole tree).
  const lastKeyRef = useRef(storageKey)
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return
    lastKeyRef.current = storageKey
    setOpenPaths(readOpenPaths(storageKey))
  }, [storageKey])

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(OPEN_STORE_PREFIX + storageKey, JSON.stringify([...openPaths]))
    } catch {
      // Private mode / quota — expansion just stops persisting.
    }
  }, [openPaths, storageKey])

  // A reveal (the context search's focused note, or the note a profile page has
  // open) expands that note's folder chain WITHOUT touching openPaths: it's a
  // transient peek layered over the real state, so clearing the search snaps the
  // tree back to exactly the folders the user opened by hand. Only clicks
  // change what's persisted.
  const revealedPaths = useMemo(
    () => (revealPath ? new Set(ancestorFolders(revealPath)) : null),
    [revealPath],
  )

  // A folder the user collapses while it's only open BECAUSE of a reveal:
  // openPaths has nothing to remove, so the collapse is recorded here instead
  // and dropped as soon as the reveal moves on.
  const [suppressedPaths, setSuppressedPaths] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setSuppressedPaths((prev) => (prev.size === 0 ? prev : new Set()))
  }, [revealPath])

  const effectiveOpenPaths = useMemo(() => {
    if (!revealedPaths && suppressedPaths.size === 0) return openPaths
    const next = new Set(openPaths)
    if (revealedPaths) for (const p of revealedPaths) next.add(p)
    for (const p of suppressedPaths) next.delete(p)
    return next
  }, [openPaths, revealedPaths, suppressedPaths])

  const toggleFolder = useCallback((path: string, isOpen: boolean) => {
    setOpenPaths((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(path)
      else next.add(path)
      return next
    })
    setSuppressedPaths((prev) => {
      const next = new Set(prev)
      if (isOpen) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

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
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-3"
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
                  canEdit={canEdit}
                  onSelect={onSelect}
                  onToggleStar={onToggleStar}
                  onDelete={onDeleteNote}
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
              icon={root.icon}
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
            />
          )}
        </div>
      </div>
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
}) {
  // A folder's own index.md never renders as a child row — the folder row IS
  // the index (clicking the folder name opens it; see FolderRow). The brain
  // root's index.md (node.path === '') stays a normal note row: there is no
  // root folder row to carry it.
  const children = (node.children ?? []).filter(
    (c) => !(node.path && c.kind === 'note' && c.path === `${node.path}/index.md`),
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
          />
        ) : (
          <NoteRow
            key={child.path}
            title={child.title ?? child.name}
            path={child.path}
            glyph={glyphFor.get(child.path) ?? null}
            selected={selectedPath === child.path}
            starred={starredSet.has(child.path)}
            canEdit={canEdit}
            onSelect={onSelect}
            onToggleStar={onToggleStar}
            onDelete={onDeleteNote}
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
  /** Overrides the folder glyph (the community avatar on the root row). */
  icon?: React.ReactNode
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
  // (The root row has no index note of its own — root's index.md stays a child
  // row, matching Tree's filter — so it only ever expands/collapses.)
  const indexPath = props.node.path ? `${props.node.path}/index.md` : ''
  const hasIndex =
    !!indexPath && (props.node.children ?? []).some((c) => c.kind === 'note' && c.path === indexPath)
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
          <span className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}>
            {props.icon ?? <FolderIcon open={open} />}
          </span>
          <span className={`truncate font-medium ${selected ? 'font-semibold' : ''}`}>
            {props.label ?? props.node.name}
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
        {showAccess && (
          <button
            type="button"
            title="Share / who can see this folder"
            onClick={() => props.onFolderAccess!(props.node.path)}
            className="shrink-0 rounded p-1 text-text-muted opacity-0 transition hover:text-text-secondary group-hover/folder:opacity-100"
          >
            <ShieldIcon />
          </button>
        )}
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
          />
        </div>
      )}
    </div>
  )
}

function NoteRow({
  title,
  path,
  glyph,
  selected,
  starred,
  canEdit,
  onSelect,
  onToggleStar,
  onDelete,
}: {
  title: string
  path: string
  glyph: NodeGlyph | null
  selected: boolean
  starred: boolean
  canEdit: boolean
  onSelect: (path: string) => void
  onToggleStar: (path: string, starred: boolean) => void
  onDelete: (path: string) => void
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
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          title={starred ? 'Unstar' : 'Star'}
          onClick={() => onToggleStar(path, !starred)}
          className={`rounded p-1 ${starred ? 'text-amber-400' : 'text-text-muted hover:text-text-secondary'}`}
        >
          <StarIcon filled={starred} />
        </button>
        {canEdit && (
          <button
            type="button"
            title="Delete"
            onClick={() => onDelete(path)}
            className="rounded p-1 text-red-500 hover:text-red-600"
          >
            <TrashIcon />
          </button>
        )}
      </div>
      {starred && (
        <span className="pointer-events-none -ml-1 text-amber-400 opacity-100 group-hover:hidden">
          <StarIcon filled />
        </span>
      )}
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
function Chevron({ open }: { open: boolean }) {
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

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
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
