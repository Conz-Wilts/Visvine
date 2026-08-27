'use client';

// The Directory as rows: one type at a time, one row per entry, one column
// per thing the type tracks. The header sorts on click, resizes on its edge
// and reorders on drag; the cells edit in place. It renders every row it is
// given — the grid virtualises because a card is heavy, a row is not.
//
// The table is its own scroll box (the view sizes it to the pane): the head
// sticks to its top and the name column to its left, so a wide table keeps
// the entry's name in view while its fields scroll.

import { useCallback, useRef, useState } from 'react';
import { clsx } from 'clsx';
import Avatar from '@/components/ui/Avatar';
import { EmptyState, Skeleton } from '@/components/ui';
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, PencilIcon } from '@/features/shared/icons';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import TableCell from './TableCell';
import {
  cellValue,
  defaultWidth,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type TableColumn,
  type TableSort,
} from '@/lib/directory/table';
import type { DirectoryItem, NodeTypeConfig, SpaceAlias } from '@/lib/types';

interface DirectoryTableProps {
  items: DirectoryItem[];
  columns: TableColumn[];
  sort: TableSort | null;
  widths: Record<string, number>;
  loading?: boolean;
  nodeTypes?: NodeTypeConfig[];
  aliases?: SpaceAlias[];
  tagColors?: Record<string, string> | null;
  onSort: (key: string) => void;
  onResize: (key: string, width: number) => void;
  onReorder: (key: string, before: string | null) => void;
  onOpen: (item: DirectoryItem) => void;
  /** Absent when nothing here may be edited. */
  onSaveCell?: (item: DirectoryItem, column: TableColumn, value: unknown) => Promise<void>;
}

const ROW_CLASS = 'group h-11 border-b border-border-subtle transition-colors hover:bg-surface-2';

export default function DirectoryTable({
  items, columns, sort, widths, loading = false,
  nodeTypes, aliases, tagColors,
  onSort, onResize, onReorder, onOpen, onSaveCell,
}: DirectoryTableProps) {
  const widthOf = (c: TableColumn) => widths[c.key] ?? defaultWidth(c);
  const totalWidth = columns.reduce((sum, c) => sum + widthOf(c), 0);

  // ── resizing: a pointer drag on the header's right edge ────────────────
  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<{ key: string; width: number } | null>(null);
  const beginResize = useCallback((e: React.PointerEvent, column: TableColumn) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizing.current = { key: column.key, startX: e.clientX, startWidth: widthOf(column) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widths]);
  const moveResize = (e: React.PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    const width = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, r.startWidth + e.clientX - r.startX));
    setLiveWidth({ key: r.key, width });
  };
  const endResize = () => {
    const r = resizing.current;
    if (!r) return;
    resizing.current = null;
    if (liveWidth && liveWidth.key === r.key) onResize(r.key, liveWidth.width);
    setLiveWidth(null);
  };

  // ── reordering: native drag of a header onto another ───────────────────
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  const effectiveWidth = (c: TableColumn) => (liveWidth?.key === c.key ? liveWidth.width : widthOf(c));

  if (loading) {
    return (
      <div className="flex flex-col divide-y divide-border-subtle">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex h-11 items-center gap-6 px-3">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState title="No entries" description="No entries of this type match. Try adjusting your filters." />;
  }

  return (
    <div className="h-full w-full overflow-auto custom-scrollbar">
      <table
        className="border-collapse text-sm"
        style={{ tableLayout: 'fixed', width: Math.max(totalWidth, 0), minWidth: '100%' }}
      >
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={{ width: effectiveWidth(c) }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-20 bg-surface-1">
          <tr className="h-10 border-b border-border-default">
            {columns.map((column, index) => {
              const active = sort?.key === column.key;
              const isName = column.source === 'name';
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  draggable
                  onDragStart={(e) => {
                    setDragKey(column.key);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', column.key);
                  }}
                  onDragOver={(e) => {
                    if (!dragKey || dragKey === column.key) return;
                    e.preventDefault();
                    setDropKey(column.key);
                  }}
                  onDragLeave={() => setDropKey((k) => (k === column.key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey && dragKey !== column.key) onReorder(dragKey, column.key);
                    setDragKey(null);
                    setDropKey(null);
                  }}
                  onDragEnd={() => { setDragKey(null); setDropKey(null); }}
                  className={clsx(
                    'group/th relative bg-surface-1 px-0 text-left align-middle text-xs font-semibold text-text-muted select-none',
                    isName && 'sticky left-0 z-10',
                    dragKey === column.key && 'opacity-40',
                    dropKey === column.key && 'shadow-[inset_2px_0_0_var(--color-brand-green)]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    className={clsx(
                      'flex h-10 w-full min-w-0 items-center gap-1.5 px-3 transition-colors hover:text-text-primary',
                      column.kind === 'number' && 'justify-end',
                      active && 'text-text-primary',
                    )}
                    title={`Sort by ${column.label}`}
                  >
                    <span className="truncate">{column.label}</span>
                    {active ? (
                      sort!.dir === 'asc'
                        ? <ArrowUpIcon className="h-3 w-3 shrink-0" />
                        : <ArrowDownIcon className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronsUpDownIcon className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/th:opacity-60" />
                    )}
                  </button>
                  {/* The resize grip: the last 6px of every header. */}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${column.label}`}
                    onPointerDown={(e) => beginResize(e, column)}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onClick={(e) => e.stopPropagation()}
                    className={clsx(
                      'absolute inset-y-2 right-0 w-1.5 cursor-col-resize rounded-full transition-colors hover:bg-border-default',
                      liveWidth?.key === column.key && 'bg-brand-green',
                      index === columns.length - 1 && 'right-0.5',
                    )}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const typeColor = getTypeColor(item.type, nodeTypes);
            const alias = item.alias ? aliases?.find((a) => a.name === item.alias) : undefined;
            return (
              <tr key={item.id} className={ROW_CLASS}>
                {columns.map((column) => {
                  const value = cellValue(item, column);
                  if (column.source === 'name') {
                    return (
                      <td
                        key={column.key}
                        className="sticky left-0 z-10 bg-surface-1 p-0 align-middle transition-colors group-hover:bg-surface-2"
                      >
                        <div className="flex h-11 min-w-0 items-center gap-2.5 pl-3 pr-1">
                          <button
                            type="button"
                            onClick={() => onOpen(item)}
                            className="flex min-w-0 items-center gap-2.5 text-left"
                            title={`Open ${item.name}`}
                          >
                            <Avatar
                              name={item.name}
                              imageUrl={item.image_url}
                              size="chip"
                              accentColor={alias?.color ?? typeColor}
                              fallback={item.type.toLowerCase() === 'person' ? 'silhouette' : 'initials'}
                            />
                            <span className="truncate font-medium text-text-primary hover:underline">{item.name}</span>
                          </button>
                          {onSaveCell && (
                            <span className="min-w-0 flex-1">
                              <RenameCell
                                name={item.name}
                                onSave={(next) => onSaveCell(item, column, next)}
                              />
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={column.key} className="h-11 p-0 align-middle">
                      <TableCell
                        column={column}
                        value={value}
                        aliasColor={alias?.color ?? typeColor}
                        tagColors={tagColors}
                        onSave={onSaveCell && column.editable ? (v) => onSaveCell(item, column, v) : undefined}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The name cell's rename affordance: a pencil that shows on hover and opens
 * the same editor the other cells use. The name itself stays a link — one
 * click opens the entry, the pencil edits it — because a name is what a row
 * is FOR and clicking it must never turn into a text field.
 */
function RenameCell({ name, onSave }: { name: string; onSave: (next: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Rename ${name}`}
        className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
      >
        <PencilIcon className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <TableCell
      column={{ key: 'name', label: 'Name', kind: 'text', source: 'name', origin: 'core', editable: true }}
      value={name}
      onSave={async (v) => {
        await onSave(v);
        setEditing(false);
      }}
      autoEdit
      onDone={() => setEditing(false)}
    />
  );
}
