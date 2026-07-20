'use client'

// The notes sidebar: starred notes and a folder/note tree. Folders expand/collapse
// and carry a folder icon; notes carry their frontmatter type's glyph (person,
// group, event, resource) or a document icon when untyped. Note rows reveal star +
// delete actions on hover. Starring is the same `starred:` frontmatter flag the
// editor toolbar's star toggles, so both surfaces always agree. Nesting is shown
// VS Code style: each level is wrapped in an indented container with a left guide
// line so folder depth reads at a glance. The tree scrolls with its scrollbar on
// the right (normal) edge.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteMeta, TreeNode } from '@/lib/notes/shared/types'
import type { FolderLevel } from '@/lib/notes/shared/brainTypes'
import type { ContextSourceMeta } from '@/lib/notes/shared/sourceTypes'
import { getNodeGlyph } from '@/lib/types'
import { NODE_GLYPH_PATHS, type NodeGlyph } from '@/lib/avatarUtils'
import { entityKindOf } from '@/lib/notes/entities'

// The glyph for a note's frontmatter type. `entityKindOf` catches "company"
// (which getNodeGlyph doesn't know) so company notes read as the group glyph.
function noteGlyph(type: string | undefined): NodeGlyph | null {
  return getNodeGlyph(type) ?? (entityKindOf(type) === 'company' ? 'group' : null)
}

/** Registry-derived adornments for a TOP-LEVEL folder row (shared brain only). */
interface FolderBadge {
  private: boolean
  locked?: boolean
  /** The viewer's own level in the folder, shown as a small chip. */
  level?: FolderLevel
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
  /** Registry badges keyed by top-level folder id (shared scope only). */
  folderBadges?: Map<string, FolderBadge>
  /** Hover action on top-level folder rows: open the folder access panel. */
  onFolderAccess?: (folderId: string) => void
  /** Render without card chrome (bg/border/shadow) — used when the sidebar sits on
   *  the shared dock backdrop, which already supplies the background and shadow. */
  bare?: boolean
  /** Context sources (uploaded files/tables) — rendered as their own section. */
  sources?: ContextSourceMeta[]
  onSelectSource?: (path: string) => void
  /** Upload affordance in the Sources section header (server gates the write). */
  onUploadSource?: (file: File) => void
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
  sources,
  onSelectSource,
  onUploadSource,
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

  // Keep the selected row in view when selection changes from outside the tree
  // (graph search focus, profile navigation). An off-screen row is centred so it
  // lands mid-panel, not clinging to an edge; an already-visible row stays put,
  // so ordinary clicks never cause a jump. Retries a few frames because a
  // collapsed ancestor folder auto-opens in response to the same selection
  // change, so the row may only mount a render later.
  const scrollRef = useRef<HTMLDivElement>(null)
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-3">
        <div>
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

          <Tree
            node={tree}
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

          {(sources?.length || onUploadSource) && (
            <SourcesSection
              sources={sources ?? []}
              selectedPath={selectedPath}
              onSelect={onSelectSource}
              onUpload={onUploadSource}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// --- context sources -------------------------------------------------------------

function SourcesSection({
  sources,
  selectedPath,
  onSelect,
  onUpload,
}: {
  sources: ContextSourceMeta[]
  selectedPath: string | null
  onSelect?: (path: string) => void
  onUpload?: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between pr-1.5">
        <SectionLabel>Sources</SectionLabel>
        {onUpload && (
          <>
            <button
              type="button"
              title="Add a source file (csv, md, txt)"
              onClick={() => inputRef.current?.click()}
              className="rounded p-1 text-text-muted transition hover:text-text-secondary"
            >
              <PlusIcon />
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.md,.markdown,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUpload(file)
                e.target.value = '' // allow re-uploading the same filename
              }}
            />
          </>
        )}
      </div>
      {sources.length === 0 ? (
        <div className="px-2 py-1 text-[13px] text-text-muted">No sources yet.</div>
      ) : (
        sources.map((s) => (
          <div
            key={s.path}
            data-note-path={s.path}
            className={`group flex items-center rounded-lg pr-1.5 transition ${
              selectedPath === s.path ? 'bg-brand-green' : 'hover:bg-surface-2'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect?.(s.path)}
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left text-[15px]"
              title={s.path}
            >
              <span className={`shrink-0 ${selectedPath === s.path ? 'text-white' : 'text-text-muted'}`}>
                <SourceFileIcon />
              </span>
              <span
                className={`truncate ${
                  selectedPath === s.path ? 'font-semibold text-white' : 'text-text-primary'
                }`}
              >
                {s.name}
              </span>
              {s.status !== 'ready' && (
                <span
                  className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${
                    s.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-surface-2 text-text-muted'
                  }`}
                >
                  {s.status}
                </span>
              )}
            </button>
          </div>
        ))
      )}
    </div>
  )
}

function Tree({
  node,
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
  const [open, setOpen] = useState(true)
  // A selection inside this folder (search focus, profile navigation) re-opens
  // it so the highlighted row is actually visible/scrollable. The folder's own
  // index.md doesn't count — it highlights on the folder row itself.
  const containsSelection =
    !!props.selectedPath?.startsWith(`${props.node.path}/`) &&
    props.selectedPath !== `${props.node.path}/index.md`
  useEffect(() => {
    if (containsSelection) setOpen(true)
  }, [containsSelection, props.selectedPath])
  // Registry adornments apply to TOP-LEVEL folders only (the registry's unit of
  // access control) — a top-level folder's tree path has no slash.
  const isTopLevel = !props.node.path.includes('/')
  const badge = isTopLevel ? props.folderBadges?.get(props.node.path) : undefined
  const showAccess = isTopLevel && !!props.onFolderAccess
  // Folder-note behaviour: when the folder has an index.md (hidden as a child
  // row by Tree), the folder row IS that note — clicking the name opens it and
  // selection highlights here. The chevron keeps expand/collapse to itself.
  const indexPath = `${props.node.path}/index.md`
  const hasIndex = (props.node.children ?? []).some((c) => c.kind === 'note' && c.path === indexPath)
  const selected = hasIndex && props.selectedPath === indexPath
  return (
    <div>
      <div
        className={`group/folder flex items-center rounded-lg pr-1.5 transition ${
          selected ? 'bg-brand-green' : 'hover:bg-surface-2'
        }`}
      >
        <button
          type="button"
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
          onClick={() => setOpen((o) => !o)}
          className={`shrink-0 py-1.5 pl-2 text-xs ${selected ? 'text-white/80' : 'text-text-muted'}`}
        >
          <span className="block w-3">{open ? '▾' : '▸'}</span>
        </button>
        <button
          type="button"
          onClick={() => (hasIndex ? props.onSelect(indexPath) : setOpen((o) => !o))}
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left text-[15px] ${
            selected ? 'text-white' : 'text-text-secondary'
          }`}
        >
          <span className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}>
            <FolderIcon open={open} />
          </span>
          <span className={`truncate font-medium ${selected ? 'font-semibold' : ''}`}>{props.node.name}</span>
          {badge?.private && (
            <span className="shrink-0 text-text-muted" title="Private folder">
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
            title="Folder access"
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
      className={`group flex items-center rounded-lg pr-1.5 transition ${
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

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}

// FileIcon with data lines — distinguishes an uploaded source from a note.
function SourceFileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
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
