'use client';

// The Context explorer's centre: the folder tree "leveled up" into the page's
// main surface. The same hierarchy the docked sidebar shows — same expansion
// state, same folder-is-its-index contract — but virtualized (a flat Virtuoso
// list over flattenVisibleRows) so a ten-thousand-note brain scrolls like a
// ten-note one, with search pruning the tree in place and keyboard navigation
// over the visible rows.
//
// Selection semantics match the rest of the browser: single click / Enter
// selects into the focus panel, double click / Cmd+Enter opens for real.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { EmptyState, Skeleton } from '@/components/ui';
import type { TreeNode, TrashEntry } from '@/lib/notes/shared/types';
import type { ContextItem } from '@/features/notes/hooks/useContextBrowse';
import { useContextTreeState } from '@/features/notes/hooks/useContextTreeState';
import { flattenVisibleRows, type TreeRow } from './contextTreeModel';
import ContextTreeRow, { type ContextTreeRowHandlers } from './ContextTreeRow';

interface ContextTreeExplorerProps {
  communityId: string;
  rootLabel: string;
  tree: TreeNode;
  /** browse.items — index notes already folded out. */
  items: ContextItem[];
  starred: string[];
  trash: TrashEntry[] | null;
  folderBadges?: Map<string, { restricted: boolean }>;
  loading: boolean;
  /** Paths surviving the active search/filters (null = nothing active). */
  keep: Set<string> | null;
  /** Search-matched paths, for row highlight. */
  matched: Set<string> | null;
  searchQuery: string;
  selectedPath: string | null;
  canEdit: boolean;
  handlers: ContextTreeRowHandlers;
}

export default function ContextTreeExplorer({
  communityId,
  rootLabel,
  tree,
  items,
  starred,
  trash,
  folderBadges,
  loading,
  keep,
  matched,
  searchQuery,
  selectedPath,
  canEdit,
  handlers,
}: ContextTreeExplorerProps) {
  // keep doubles as the force-open overlay: it already contains the ancestor
  // closure of every match, and stray note paths are no-ops in an open-set.
  const { effectiveOpenPaths, toggleFolder } = useContextTreeState(communityId, selectedPath, keep);

  const itemsByPath = useMemo(() => new Map(items.map((i) => [i.path, i])), [items]);
  const starredSet = useMemo(() => new Set(starred), [starred]);

  const rows = useMemo(
    () =>
      flattenVisibleRows({
        tree,
        itemsByPath,
        openPaths: effectiveOpenPaths,
        keep,
        matched,
        starred,
        trash,
        rootLabel,
      }),
    [tree, itemsByPath, effectiveOpenPaths, keep, matched, starred, trash, rootLabel],
  );

  const rowHandlers = useMemo<ContextTreeRowHandlers>(
    () => ({ ...handlers, onToggleFolder: toggleFolder }),
    [handlers, toggleFolder],
  );

  // ── Keyboard navigation: one roving focus over the flat rows ────────────────
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  useEffect(() => {
    if (focusIndex >= rows.length) setFocusIndex(rows.length - 1);
  }, [rows.length, focusIndex]);

  const moveFocus = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, index));
      setFocusIndex(clamped);
      virtuosoRef.current?.scrollIntoView({ index: clamped });
    },
    [rows.length],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rows.length === 0) return;
      const row = rows[focusIndex] as TreeRow | undefined;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(focusIndex + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(focusIndex - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (!row) return moveFocus(0);
          if ((row.kind === 'folder' || row.kind === 'trash') && !row.isOpen) {
            toggleFolder(row.path, false);
          } else {
            moveFocus(focusIndex + 1);
          }
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          if (!row) return moveFocus(0);
          if ((row.kind === 'folder' || row.kind === 'trash') && row.isOpen) {
            toggleFolder(row.path, true);
          } else {
            // Jump to the parent: the nearest prior row one level shallower.
            for (let i = focusIndex - 1; i >= 0; i--) {
              if (rows[i].depth < row.depth) return moveFocus(i);
            }
          }
          break;
        }
        case 'Enter':
          if (!row) return;
          e.preventDefault();
          // A folder IS its index note, so Enter opens it the way it does for a
          // note; ←/→ are the expand/collapse keys. Trash and index-less folders
          // have nothing to open, so they still toggle.
          if (row.kind === 'folder' && row.indexPath) {
            if (e.metaKey || e.ctrlKey) handlers.onOpenNote(row.indexPath);
            else handlers.onSelectNote(row.indexPath);
          } else if (row.kind === 'folder' || row.kind === 'trash') {
            toggleFolder(row.path, row.isOpen ?? false);
          } else if (row.kind === 'note') {
            if (e.metaKey || e.ctrlKey) handlers.onOpenNote(row.path);
            else handlers.onSelectNote(row.path);
          }
          break;
      }
    },
    [rows, focusIndex, moveFocus, toggleFolder, handlers],
  );

  // Reveal an externally-driven selection (ego-graph click, profile navigation):
  // the reveal overlay has already expanded its chain this same render, so the
  // row is in `rows` — scroll it into view and hand it the keyboard focus.
  useEffect(() => {
    if (!selectedPath) return;
    const index = rows.findIndex((r) => r.key === selectedPath || (r.kind === 'folder' && r.indexPath === selectedPath));
    if (index >= 0) {
      setFocusIndex(index);
      virtuosoRef.current?.scrollIntoView({ index });
    }
    // rows is deliberately not a dependency: re-running on every expansion
    // toggle would yank the scroll back to the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 px-4 py-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-lg" style={{ width: `${100 - (i % 4) * 8}%` }} />
        ))}
      </div>
    );
  }

  if (items.length === 0 && !trash?.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="No notes"
          description="This context is empty — notes added to it will show up here."
        />
      </div>
    );
  }

  if (rows.length <= 1 && keep) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="No matches" description="No notes match this search or filter." />
      </div>
    );
  }

  return (
    <div
      role="tree"
      aria-label="Context notes"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full min-h-0 outline-none"
    >
      <Virtuoso
        ref={virtuosoRef}
        data={rows}
        computeItemKey={(_, row) => row.key}
        increaseViewportBy={200}
        itemContent={(index, row) => (
          <div
            role={row.kind === 'note' || row.kind === 'folder' ? 'treeitem' : undefined}
            aria-level={row.depth + 1}
            aria-expanded={row.kind === 'folder' ? row.isOpen : undefined}
            aria-selected={
              row.kind === 'note' || row.kind === 'folder'
                ? row.key === selectedPath || row.indexPath === selectedPath
                : undefined
            }
            className="px-3"
          >
            <ContextTreeRow
              row={row}
              selected={row.key === selectedPath || (row.kind === 'folder' && row.indexPath === selectedPath)}
              focused={index === focusIndex}
              starredSet={starredSet}
              restricted={folderBadges?.get(row.path)?.restricted ?? false}
              canEdit={canEdit}
              searchQuery={searchQuery}
              handlers={rowHandlers}
            />
          </div>
        )}
      />
    </div>
  );
}
