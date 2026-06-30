'use client'

// The notes sidebar: pinned notes and a folder/note tree. Folders expand/collapse
// and carry a folder icon; notes carry a document icon. Note rows reveal pin +
// delete actions on hover. Nesting is shown VS Code style: each level is wrapped
// in an indented container with a left guide line so folder depth reads at a
// glance. The tree scrolls with its scrollbar on the right (normal) edge.

import { useMemo, useState } from 'react'
import type { NoteMeta, TreeNode } from '@/lib/notes/shared/types'

interface NoteSidebarProps {
  tree: TreeNode
  notes: NoteMeta[]
  pinned: string[]
  selectedPath: string | null
  canEdit: boolean
  onSelect: (path: string) => void
  onTogglePin: (path: string, pinned: boolean) => void
  onDeleteNote: (path: string) => void
  /** Render without card chrome (bg/border/shadow) — used when the sidebar sits on
   *  the shared dock backdrop, which already supplies the background and shadow. */
  bare?: boolean
}

export function NoteSidebar({
  tree,
  notes,
  pinned,
  selectedPath,
  canEdit,
  onSelect,
  onTogglePin,
  onDeleteNote,
  bare = false,
}: NoteSidebarProps) {
  const pinnedSet = useMemo(() => new Set(pinned), [pinned])
  const titleFor = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of notes) map.set(n.path, n.title)
    return map
  }, [notes])

  const pinnedNotes = useMemo(
    () => pinned.map((p) => ({ path: p, title: titleFor.get(p) ?? p })).filter((n) => titleFor.has(n.path)),
    [pinned, titleFor],
  )

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-l-none rounded-r-2xl ${
        bare ? '' : 'border border-border-default bg-surface-1 shadow-float'
      }`}
    >
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div>
          {pinnedNotes.length > 0 && (
            <div className="mb-2">
              <SectionLabel>Pinned</SectionLabel>
              {pinnedNotes.map((n) => (
                <NoteRow
                  key={n.path}
                  title={n.title}
                  path={n.path}
                  selected={selectedPath === n.path}
                  pinned
                  canEdit={canEdit}
                  onSelect={onSelect}
                  onTogglePin={onTogglePin}
                  onDelete={onDeleteNote}
                />
              ))}
            </div>
          )}

          <Tree
            node={tree}
            selectedPath={selectedPath}
            pinnedSet={pinnedSet}
            canEdit={canEdit}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
            onDeleteNote={onDeleteNote}
          />
        </div>
      </div>
    </div>
  )
}

function Tree({
  node,
  selectedPath,
  pinnedSet,
  canEdit,
  onSelect,
  onTogglePin,
  onDeleteNote,
}: {
  node: TreeNode
  selectedPath: string | null
  pinnedSet: Set<string>
  canEdit: boolean
  onSelect: (path: string) => void
  onTogglePin: (path: string, pinned: boolean) => void
  onDeleteNote: (path: string) => void
}) {
  const children = node.children ?? []
  return (
    <>
      {children.map((child) =>
        child.kind === 'folder' ? (
          <FolderRow
            key={child.path}
            node={child}
            selectedPath={selectedPath}
            pinnedSet={pinnedSet}
            canEdit={canEdit}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
            onDeleteNote={onDeleteNote}
          />
        ) : (
          <NoteRow
            key={child.path}
            title={child.title ?? child.name}
            path={child.path}
            selected={selectedPath === child.path}
            pinned={pinnedSet.has(child.path)}
            canEdit={canEdit}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
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
  pinnedSet: Set<string>
  canEdit: boolean
  onSelect: (path: string) => void
  onTogglePin: (path: string, pinned: boolean) => void
  onDeleteNote: (path: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-2 pr-2 text-left text-[15px] text-text-secondary transition hover:bg-surface-2"
      >
        <span className="w-3 shrink-0 text-xs text-text-muted">{open ? '▾' : '▸'}</span>
        <span className="shrink-0 text-text-muted">
          <FolderIcon open={open} />
        </span>
        <span className="truncate font-medium">{props.node.name}</span>
      </button>
      {open && (
        // Indented child container with a left guide line (VS Code style).
        <div className="ml-[15px] border-l border-border-default/70 pl-[2px]">
          <Tree
            node={props.node}
            selectedPath={props.selectedPath}
            pinnedSet={props.pinnedSet}
            canEdit={props.canEdit}
            onSelect={props.onSelect}
            onTogglePin={props.onTogglePin}
            onDeleteNote={props.onDeleteNote}
          />
        </div>
      )}
    </div>
  )
}

function NoteRow({
  title,
  path,
  selected,
  pinned,
  canEdit,
  onSelect,
  onTogglePin,
  onDelete,
}: {
  title: string
  path: string
  selected: boolean
  pinned: boolean
  canEdit: boolean
  onSelect: (path: string) => void
  onTogglePin: (path: string, pinned: boolean) => void
  onDelete: (path: string) => void
}) {
  return (
    <div
      className={`group flex items-center rounded-lg pr-1.5 transition ${
        selected ? 'bg-brand-light-bg' : 'hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(path)}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left text-[15px]"
      >
        <span className={`shrink-0 ${selected ? 'text-brand-dark-green' : 'text-text-muted'}`}>
          <FileIcon />
        </span>
        <span className={`truncate ${selected ? 'font-semibold text-brand-dark-green' : 'text-text-primary'}`}>
          {title}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          title={pinned ? 'Unpin' : 'Pin'}
          onClick={() => onTogglePin(path, !pinned)}
          className={`rounded p-1 ${pinned ? 'text-brand-dark-green' : 'text-text-muted hover:text-text-secondary'}`}
        >
          <PinIcon filled={pinned} />
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
      {pinned && (
        <span className="pointer-events-none -ml-1 text-brand-dark-green opacity-100 group-hover:hidden">
          <PinIcon filled />
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

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  )
}

function PinIcon({ filled = false }: { filled?: boolean }) {
  // A compact thumbtack (tack pointing down) — reads smaller and cleaner than the
  // angled pushpin. Fills when pinned.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4v6l-2 3v1h10v-1l-2-3V4" />
      <path d="M7 4h10" />
      <path d="M12 14v6" />
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
