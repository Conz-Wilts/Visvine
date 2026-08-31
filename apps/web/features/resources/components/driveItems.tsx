'use client';

/**
 * The Drive's tiles: a folder tile, a file card, and the kebab menu they both
 * carry. Drag-and-drop between them speaks one
 * payload (`DRAG_TYPE`) so a file or folder can be dropped on any folder tile
 * or breadcrumb.
 */

import { useRef, useState, type DragEvent } from 'react';
import { FolderIcon } from '@/features/shared/icons';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import { DROPDOWN_MENU_CLASS } from '@/components/ui/Dropdown';
import { FILE_BG, FileTypeIcon, INDEX_STATE_LABEL } from './resourceUi';
import type { Resource, ResourceFolder } from '@/lib/types';

// ─── Drag payload ─────────────────────────────────────────────────────────────

const DRAG_TYPE = 'application/x-visvine-drive';
export type DragItem = { kind: 'file' | 'folder'; id: string };

function setDragItem(e: DragEvent, item: DragItem) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item));
  e.dataTransfer.effectAllowed = 'move';
}

function readDragItem(e: DragEvent): DragItem | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    return raw ? (JSON.parse(raw) as DragItem) : null;
  } catch {
    return null;
  }
}

function isDriveDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DRAG_TYPE);
}

/** Drop-target wiring shared by folder tiles, rows and breadcrumbs. */
export function useDropTarget(onDrop: (item: DragItem) => void, accept = true) {
  const [over, setOver] = useState(false);
  return {
    over: over && accept,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!accept || !isDriveDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        if (!accept) return;
        const item = readDragItem(e);
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop(item);
      },
    },
  };
}

// ─── Kebab menu ───────────────────────────────────────────────────────────────

export interface MenuAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** A hairline above this item. */
  separator?: boolean;
}

function ItemMenu({ actions, className = '' }: { actions: MenuAction[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} className={`relative ${className}`} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        aria-label="More actions"
        onClick={() => setOpen(o => !o)}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary ${open ? 'bg-surface-3 text-text-primary' : ''}`}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className={`${DROPDOWN_MENU_CLASS} left-auto right-0 min-w-[180px]`}>
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setOpen(false); a.onSelect(); }}
              className={`flex w-full items-center px-4 py-2 text-left text-sm transition-colors hover:bg-surface-2 ${
                a.separator ? 'mt-1 border-t border-border-subtle pt-3' : ''
              } ${a.danger ? 'text-red-600' : 'text-text-primary'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Folder tile ──────────────────────────────────────────────────────────────

export function FolderTile({
  folder,
  actions,
  onOpen,
  onDropItem,
}: {
  folder: ResourceFolder;
  actions: MenuAction[];
  onOpen: () => void;
  onDropItem: (item: DragItem) => void;
}) {
  const { over, handlers } = useDropTarget(onDropItem);
  return (
    <div
      draggable
      onDragStart={e => setDragItem(e, { kind: 'folder', id: folder.id })}
      onDoubleClick={onOpen}
      onClick={onOpen}
      {...handlers}
      className={`group flex h-16 cursor-pointer select-none items-center gap-3.5 rounded-xl border border-brand-green/40 bg-surface-2 pl-5 pr-1 transition-colors hover:border-brand-green/60 hover:bg-surface-3 ${
        over ? 'ring-2 ring-brand-green ring-inset bg-brand-green/10' : ''
      }`}
    >
      <FolderIcon className="h-6 w-6 shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-text-primary">{folder.name}</span>
      <ItemMenu actions={actions} className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" />
    </div>
  );
}

// ─── File card ────────────────────────────────────────────────────────────────

/** The big glyph a file without a thumbnail shows — Drive's Docs/Sheets square. */
function FileGlyph({ type }: { type: string }) {
  const bg = (FILE_BG[type] ?? 'bg-surface-3 text-text-muted').split(' ')[0];
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className={`rounded-xl ${bg}`}>
        <FileTypeIcon type={type} className="h-16 w-16 bg-transparent" />
      </div>
    </div>
  );
}

export function FileCard({
  resource,
  selected,
  pinned,
  actions,
  onOpen,
}: {
  resource: Resource;
  selected: boolean;
  pinned: boolean;
  actions: MenuAction[];
  onOpen: () => void;
}) {
  const state = resource.indexState !== 'indexed' ? INDEX_STATE_LABEL[resource.indexState] : undefined;
  return (
    <div
      draggable
      onDragStart={e => setDragItem(e, { kind: 'file', id: resource.id })}
      onClick={onOpen}
      className={`group flex cursor-pointer select-none flex-col overflow-hidden rounded-xl transition-colors ${
        selected ? 'bg-brand-green/10' : 'bg-surface-2 hover:bg-surface-3'
      }`}
    >
      <div className="flex h-12 items-center gap-3 pl-4 pr-1">
        <FileTypeIcon type={resource.fileType} className="h-6 w-6 shrink-0 rounded-md [&>svg]:h-4 [&>svg]:w-4" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary" title={resource.name}>
          {resource.name}
        </span>
        {pinned && (
          <svg className="h-3.5 w-3.5 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 24 24">
            <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        )}
        <ItemMenu actions={actions} className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" />
      </div>
      <div className="mx-2 mb-2 aspect-[4/3] overflow-hidden rounded-lg bg-surface-1">
        {resource.fileType === 'image' && resource.fileUrl ? (
          <img src={resource.fileUrl} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
        ) : (
          <FileGlyph type={resource.fileType} />
        )}
      </div>
      {state && (
        <p
          title={resource.indexError ?? undefined}
          className={`px-4 pb-2 text-[11px] ${state.className.includes('red') ? 'text-red-600' : 'text-text-muted'}`}
        >
          {state.label}
        </p>
      )}
    </div>
  );
}
