'use client';

// One row of the Context explorer's tree. Deliberately spare: a type glyph, the
// title (with search highlight) and the row menu. Tags, link counts and update
// times all live one column over on the selected note — repeating them on every
// row turned the tree into a wall of chips and made the hierarchy, which is the
// thing this column exists to show, the hardest part to see. Folder rows show
// how many notes live under them; trash rows carry restore/purge. Depth renders
// as plain indentation (the list is flat for virtualization, so there are no
// nested containers to draw guide lines with).

import React from 'react';
import { TRASH_RETENTION_DAYS } from '@/lib/notes/shared/types';
import { isIndexPath } from '@/lib/notes/shared/indexNote';
import {
  Chevron,
  FileIcon,
  FolderIcon,
  GlyphIcon,
  LockIcon,
  RestoreIcon,
  RowMenu,
  ShareIcon,
  StarIcon,
  TrashIcon,
  daysLeft,
  noteGlyph,
  type RowMenuItem,
} from '@/features/notes/components/NoteSidebar';
import type { TreeRow } from './contextTreeModel';

const INDENT_PX = 22;

/** Case-insensitive single-range highlight — plain spans, no HTML injection. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="rounded-sm bg-brand-gold/30">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
}

export interface ContextTreeRowHandlers {
  onToggleFolder: (path: string, isOpen: boolean) => void;
  onSelectNote: (path: string) => void;
  onOpenNote: (path: string) => void;
  onToggleStar: (path: string, starred: boolean) => void;
  onDeleteNote: (path: string) => void;
  onShareNote?: (path: string) => void;
  onFolderAccess?: (path: string) => void;
  onDeleteFolder?: (path: string, label?: string) => void;
  onRestoreTrash?: (id: string) => void;
  onPurgeTrash?: (id: string) => void;
  onEmptyTrash?: () => void;
}

interface ContextTreeRowProps {
  row: TreeRow;
  selected: boolean;
  focused: boolean;
  starredSet: Set<string>;
  restricted?: boolean;
  canEdit: boolean;
  searchQuery: string;
  handlers: ContextTreeRowHandlers;
}

function RowShell({
  depth,
  selected,
  focused,
  children,
  groupClass,
  onClick,
  onDoubleClick,
  dataPath,
}: {
  depth: number;
  selected: boolean;
  focused: boolean;
  children: React.ReactNode;
  groupClass: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  dataPath?: string;
}) {
  return (
    <div
      data-note-path={dataPath}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`${groupClass} flex h-9 cursor-pointer items-center gap-2 rounded-lg pr-2 transition-colors ${
        selected
          ? 'bg-brand-green text-white'
          : focused
            ? 'bg-surface-2 ring-1 ring-inset ring-border-default'
            : 'hover:bg-surface-2'
      }`}
      style={{ paddingLeft: 8 + depth * INDENT_PX }}
    >
      {children}
    </div>
  );
}

export default function ContextTreeRow({
  row,
  selected,
  focused,
  starredSet,
  restricted = false,
  canEdit,
  searchQuery,
  handlers,
}: ContextTreeRowProps) {
  if (row.kind === 'section') {
    return (
      <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {row.label}
      </div>
    );
  }

  if (row.kind === 'trash') {
    const menuItems: RowMenuItem[] =
      handlers.onEmptyTrash && (row.childCount ?? 0) > 0
        ? [{ label: 'Empty trash', icon: <TrashIcon />, danger: true, onClick: handlers.onEmptyTrash }]
        : [];
    return (
      <RowShell
        depth={row.depth}
        selected={false}
        focused={focused}
        groupClass="group/trash mt-2"
        onClick={() => handlers.onToggleFolder(row.path, row.isOpen ?? false)}
      >
        <Chevron open={row.isOpen ?? false} />
        <span className="shrink-0 text-text-muted">
          <TrashIcon />
        </span>
        <span className="truncate text-[15px] font-medium text-text-secondary">Trash</span>
        {(row.childCount ?? 0) > 0 && (
          <span className="shrink-0 text-[11px] font-semibold text-text-muted">{row.childCount}</span>
        )}
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
          <RowMenu selected={false} hoverClass="group-hover/trash:opacity-100" items={menuItems} />
        </span>
      </RowShell>
    );
  }

  if (row.kind === 'trash-entry') {
    const entry = row.trashEntry!;
    const left = daysLeft(entry.deletedAt);
    return (
      <RowShell depth={row.depth} selected={false} focused={focused} groupClass="group" onClick={() => {}}>
        <span className="shrink-0 text-text-muted">
          <FileIcon />
        </span>
        <span className="truncate text-[15px] text-text-secondary" title={entry.path}>
          {entry.name}
        </span>
        <span className="shrink-0 text-[11px] text-text-muted" title={`Purged after ${TRASH_RETENTION_DAYS} days`}>
          {left === 0 ? 'today' : `${left}d`}
        </span>
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
          <RowMenu
            selected={false}
            items={[
              ...(handlers.onRestoreTrash
                ? [{ label: 'Restore', icon: <RestoreIcon />, onClick: () => handlers.onRestoreTrash!(entry.id) }]
                : []),
              ...(handlers.onPurgeTrash
                ? [{ label: 'Delete forever', icon: <TrashIcon />, danger: true, onClick: () => handlers.onPurgeTrash!(entry.id) }]
                : []),
            ]}
          />
        </span>
      </RowShell>
    );
  }

  if (row.kind === 'folder') {
    const isOpen = row.isOpen ?? false;
    // A folder IS its index note, so clicking the row OPENS that note and the
    // chevron is the only expand/collapse control — the same split Obsidian and
    // Notion use for folder notes. A folder with no visible index (a grafted
    // empty folder the caller can't read into) falls back to toggling, so the
    // row is never inert.
    // No Star here: a folder IS its index note, and index notes aren't
    // starrable — the Starred section lists notes, not a second folder tree.
    const menuItems: RowMenuItem[] = [
      ...(handlers.onFolderAccess && row.path
        ? [{ label: 'Share', icon: <ShareIcon />, onClick: () => handlers.onFolderAccess!(row.path) }]
        : []),
      ...(handlers.onDeleteFolder && row.path
        ? [{ label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => handlers.onDeleteFolder!(row.path, row.label) }]
        : []),
    ];
    return (
      <RowShell
        depth={row.depth}
        selected={selected}
        focused={focused}
        groupClass="group/folder"
        onClick={() =>
          row.indexPath
            ? handlers.onSelectNote(row.indexPath)
            : handlers.onToggleFolder(row.path, isOpen)
        }
        onDoubleClick={row.indexPath ? () => handlers.onOpenNote(row.indexPath!) : undefined}
        dataPath={row.indexPath}
      >
        <button
          type="button"
          aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
          onClick={(e) => {
            e.stopPropagation();
            handlers.onToggleFolder(row.path, isOpen);
          }}
          className={`shrink-0 rounded p-0.5 ${
            selected ? 'text-white' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Chevron open={isOpen} />
        </button>
        <span className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}>
          <FolderIcon open={isOpen} />
        </span>
        <span className={`truncate text-[15px] font-medium ${selected ? 'text-white' : 'text-text-primary'}`}>
          <HighlightedText text={row.label ?? ''} query={searchQuery} />
        </span>
        {restricted && (
          <span
            className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}
            title="Restricted folder — access is granted here, not inherited"
          >
            <LockIcon />
          </span>
        )}
        <span className={`shrink-0 text-[11px] font-semibold ${selected ? 'text-white/80' : 'text-text-muted'}`}>
          {row.childCount}
        </span>
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
          <RowMenu selected={selected} hoverClass="group-hover/folder:opacity-100" items={menuItems} />
        </span>
      </RowShell>
    );
  }

  // Note row.
  const item = row.item!;
  const glyph = noteGlyph(item.type ?? undefined);
  const starred = starredSet.has(item.path);
  return (
    <div>
      <RowShell
        depth={row.depth}
        selected={selected}
        focused={focused}
        groupClass="group"
        onClick={() => handlers.onSelectNote(item.path)}
        onDoubleClick={() => handlers.onOpenNote(item.path)}
        dataPath={item.path}
      >
        <span className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}>
          {glyph ? <GlyphIcon glyph={glyph} /> : <FileIcon />}
        </span>
        <span className={`min-w-0 truncate text-[15px] ${selected ? 'font-semibold text-white' : 'text-text-primary'}`}>
          {row.matched ? <HighlightedText text={item.title} query={searchQuery} /> : item.title}
        </span>
        {restricted && (
          <span
            className={`shrink-0 ${selected ? 'text-white' : 'text-text-muted'}`}
            title="Private note — access from its folders is cut off"
          >
            <LockIcon />
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <span onClick={(e) => e.stopPropagation()}>
            <RowMenu
              selected={selected}
              items={[
                ...(handlers.onShareNote
                  ? [{ label: 'Share', icon: <ShareIcon />, onClick: () => handlers.onShareNote!(item.path) }]
                  : []),
                ...(isIndexPath(item.path)
                  ? []
                  : [{
                      label: starred ? 'Unstar' : 'Star',
                      icon: <StarIcon filled={starred} />,
                      onClick: () => handlers.onToggleStar(item.path, !starred),
                    }]),
                ...(canEdit
                  ? [{ label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => handlers.onDeleteNote(item.path) }]
                  : []),
              ]}
            />
          </span>
        </span>
      </RowShell>
      {item.snippet && (
        <p
          className="line-clamp-2 pb-1 pr-4 text-[12px] leading-snug text-text-muted"
          style={{ paddingLeft: 8 + (row.depth + 1) * INDENT_PX }}
        >
          {item.snippet}
        </p>
      )}
    </div>
  );
}

