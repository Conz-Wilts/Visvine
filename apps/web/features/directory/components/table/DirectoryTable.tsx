'use client';

// The Directory as rows: one type at a time, one row per entry, one column
// per thing the type tracks. The shape is the spreadsheet one: a framed grid
// with a numbered name column, each header wearing its kind's glyph and
// opening a menu of what can be done to the column — sort, step, hide, and
// an admin's edit — with the column it opened for lit under it; a drag
// reorders a column, its right edge resizes it, and the "+" past the last
// one shows a hidden column or mints a new field without leaving the table.
// A footer row under the grid counts what is there: how many entries, and
// per column how many carry a value.
//
// The table is its own scroll box (the view sizes it to the pane): the head
// sticks to its top and the name column to its left, so a wide table keeps
// the entry's name in view while its fields scroll. The header menus portal
// out of the scroll box (HeaderPopover) for the same reason.
//
// Rows are windowed (TableVirtuoso): only the rows in or near the viewport
// are mounted, and a row scrolled away is unmounted. A space of a few
// thousand entries would otherwise cost a few thousand rows of cells — each
// with an avatar, a tag list and an editor — on every filter keystroke. The
// scroll box IS the virtualiser's scroller, so the head and name column stay
// sticky against the same element that windows the rows.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { TableVirtuoso, type TableComponents } from 'react-virtuoso';
import Avatar from '@/components/ui/Avatar';
import { ConfirmDialog, EmptyState, Skeleton } from '@/components/ui';
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon } from '@/features/shared/icons';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import AddColumnMenu from './AddColumnMenu';
import ColumnHeaderMenu from './ColumnHeaderMenu';
import HeaderPopover from './HeaderPopover';
import TableCell from './TableCell';
import { ColumnKindIcon } from './columnKindIcon';
import { type FieldOps } from './AddFieldForm';
import {
  cellValue,
  defaultWidth,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type TableColumn,
  type TableSort,
} from '@/lib/directory/table';
import { getNodeTypeConfig, type DirectoryItem, type NodeTypeConfig, type SpaceAlias } from '@/lib/types';

interface DirectoryTableProps {
  items: DirectoryItem[];
  columns: TableColumn[];
  /** The type's columns this view hides — the "+" menu's stock. */
  hiddenColumns: TableColumn[];
  typeName: string;
  sort: TableSort | null;
  widths: Record<string, number>;
  loading?: boolean;
  nodeTypes?: NodeTypeConfig[];
  aliases?: SpaceAlias[];
  tagColors?: Record<string, string> | null;
  /** Absent for non-admins: the tracked-field editor behind "+" and "Edit field". */
  fields?: FieldOps;
  onSortChange: (sort: TableSort | null) => void;
  onResize: (key: string, width: number) => void;
  onReorder: (key: string, before: string | null) => void;
  onShowColumn: (key: string) => void;
  onHideColumn: (key: string) => void;
  onOpen: (item: DirectoryItem) => void;
  /** Absent when nothing here may be edited. */
  onSaveCell?: (item: DirectoryItem, column: TableColumn, value: unknown) => Promise<void>;
}

/** The width of the "+" header cell at the row's end. */
const ADD_COLUMN_WIDTH = 44;

/** What the table's frame components need that a row's content doesn't: the
 *  column layout the `<colgroup>` is built from. */
interface TableContext {
  columns: TableColumn[];
  widthOf: (column: TableColumn) => number;
  totalWidth: number;
}

// The virtualiser's frame: the scroll box, the table, its head and body. Each
// merges Virtuoso's inline style (it sizes and positions these) with the
// classes the design needs. Cast through `unknown` once, the way the grid
// does: react-virtuoso resolves a second copy of @types/react, so its ref
// types are nominally distinct from the app's while the runtime contract is
// identical.
const Scroller = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function Scroller(props, ref) {
    return <div ref={ref} {...props} className="h-full w-full overflow-auto custom-scrollbar" />;
  },
);

function Table({ style, children, context }: React.ComponentPropsWithoutRef<'table'> & { context?: TableContext }) {
  const { columns = [], widthOf, totalWidth = 0 } = context ?? {};
  return (
    <table
      className="border-collapse text-sm"
      style={{ ...style, tableLayout: 'fixed', width: Math.max(totalWidth, 0), minWidth: '100%' }}
    >
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: widthOf?.(c) }} />
        ))}
        <col style={{ width: ADD_COLUMN_WIDTH }} />
        {/* The filler absorbs any pane width past the columns, so the
            gridlines end where the data does rather than stretching. */}
        <col />
      </colgroup>
      {children}
    </table>
  );
}

// z-20, above the body's sticky name cells (z-10): Virtuoso's own inline
// z-index on the head is 1, which the name column would scroll over.
const TableHead = React.forwardRef<HTMLTableSectionElement, React.ComponentPropsWithoutRef<'thead'>>(
  function TableHead({ style, ...props }, ref) {
    return <thead ref={ref} {...props} style={{ ...style, zIndex: 20 }} className="bg-surface-1" />;
  },
);

const TableRow = ({ item: _item, style, ...props }: React.ComponentPropsWithoutRef<'tr'> & { item?: DirectoryItem }) => (
  <tr
    {...props}
    style={style}
    className="group h-11 border-b border-border-subtle transition-colors hover:bg-surface-2"
  />
);

// Sticky at the foot the way the head is at the top, and above the name
// column for the same reason.
const TableFoot = React.forwardRef<HTMLTableSectionElement, React.ComponentPropsWithoutRef<'tfoot'>>(
  function TableFoot({ style, ...props }, ref) {
    return <tfoot ref={ref} {...props} style={{ ...style, zIndex: 20 }} className="bg-surface-1" />;
  },
);

const tableComponents = { Scroller, Table, TableHead, TableRow, TableFoot } as unknown as TableComponents<DirectoryItem, TableContext>;

export default function DirectoryTable({
  items, columns, hiddenColumns, typeName, sort, widths, loading = false,
  nodeTypes, aliases, tagColors, fields,
  onSortChange, onResize, onReorder, onShowColumn, onHideColumn, onOpen, onSaveCell,
}: DirectoryTableProps) {
  const widthOf = (c: TableColumn) => widths[c.key] ?? defaultWidth(c);
  const totalWidth = columns.reduce((sum, c) => sum + widthOf(c), 0) + ADD_COLUMN_WIDTH;

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
  // The column dropped in front of, or 'end' for the strip past the last one.
  const [dropKey, setDropKey] = useState<string | 'end' | null>(null);

  // ── the header menus, portalled past the scroll box ─────────────────────
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [removing, setRemoving] = useState<TableColumn | null>(null);
  const closeMenus = useCallback(() => {
    setMenu(null);
    setAddAnchor(null);
  }, []);

  const effectiveWidth = useCallback(
    (c: TableColumn) => (liveWidth?.key === c.key ? liveWidth.width : widths[c.key] ?? defaultWidth(c)),
    [liveWidth, widths],
  );
  const tableContext = useMemo<TableContext>(
    () => ({ columns, widthOf: effectiveWidth, totalWidth }),
    [columns, effectiveWidth, totalWidth],
  );
  const menuColumn = menu ? columns.find((c) => c.key === menu.key) ?? null : null;
  const menuIndex = menuColumn ? columns.indexOf(menuColumn) : -1;
  // The column the open menu is for: lit down its whole length, so what the
  // menu acts on is never in doubt.
  const litKey = menu?.key ?? null;

  // The footer's figures: how many rows carry a value in each column.
  const filled = useMemo(() => {
    const counts = new Map<string, number>();
    for (const column of columns) {
      if (column.source === 'name') continue;
      let n = 0;
      for (const item of items) {
        const v = cellValue(item, column);
        if (v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)) continue;
        n += 1;
      }
      counts.set(column.key, n);
    }
    return counts;
  }, [items, columns]);

  if (loading) {
    return (
      <div className="flex flex-col divide-y divide-border-subtle">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex h-12 items-center gap-6 px-3">
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
    <div className="h-full w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-1">
      <TableVirtuoso<DirectoryItem, TableContext>
        data={items}
        context={tableContext}
        components={tableComponents}
        computeItemKey={(_, item) => item.id}
        increaseViewportBy={{ top: 240, bottom: 480 }}
        fixedHeaderContent={() => (
          <tr className="h-10 border-b border-border-default">
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const isName = column.source === 'name';
              const lit = litKey === column.key;
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
                    'group/th relative border-r border-border-subtle px-0 text-left align-middle text-[13px] font-medium text-text-secondary select-none',
                    lit ? 'bg-surface-2' : 'bg-surface-1',
                    isName && 'sticky left-0 z-10',
                    dragKey === column.key && 'opacity-40',
                    dropKey === column.key && 'shadow-[inset_2px_0_0_var(--color-brand-green)]',
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      setAddAnchor(null);
                      setMenu((m) => (m?.key === column.key ? null : { key: column.key, anchor: e.currentTarget }));
                    }}
                    aria-haspopup="menu"
                    aria-expanded={menu?.key === column.key}
                    className={clsx(
                      'flex h-10 w-full min-w-0 items-center gap-2 px-3 transition-colors hover:text-text-primary',
                      column.kind === 'number' && 'justify-end',
                      (active || lit) && 'text-text-primary',
                    )}
                    title={`${column.label} column`}
                  >
                    {isName && <span aria-hidden className="w-6 shrink-0" />}
                    <ColumnKindIcon column={column} className="h-4 w-4 shrink-0 text-text-muted" />
                    <span className="truncate">{column.label}</span>
                    {active && (
                      sort!.dir === 'asc'
                        ? <ArrowUpIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-text-muted" />
                        : <ArrowDownIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-text-muted" />
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
                    )}
                  />
                </th>
              );
            })}
            <th
              scope="col"
              onDragOver={(e) => {
                if (!dragKey) return;
                e.preventDefault();
                setDropKey('end');
              }}
              onDragLeave={() => setDropKey((k) => (k === 'end' ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragKey) onReorder(dragKey, null);
                setDragKey(null);
                setDropKey(null);
              }}
              className={clsx(
                'bg-surface-1 p-0 align-middle',
                dropKey === 'end' && 'shadow-[inset_2px_0_0_var(--color-brand-green)]',
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  setMenu(null);
                  setAddAnchor((a) => (a ? null : e.currentTarget));
                }}
                aria-haspopup="menu"
                aria-expanded={addAnchor !== null}
                aria-label="Add a column"
                title="Add a column"
                className={clsx(
                  'flex h-10 w-full items-center justify-center text-text-muted transition-colors hover:text-text-primary',
                  addAnchor && 'text-text-primary',
                )}
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            </th>
            <th aria-hidden className="bg-surface-1 p-0" />
          </tr>
        )}
        fixedFooterContent={() => (
          <tr className="h-10 border-t border-border-default text-[12.5px]">
            {columns.map((column) => {
              const isName = column.source === 'name';
              const lit = litKey === column.key;
              return (
                <td
                  key={column.key}
                  className={clsx(
                    'border-r border-border-subtle px-3 align-middle',
                    lit ? 'bg-surface-2' : 'bg-surface-1',
                    isName && 'sticky left-0 z-10',
                    column.kind === 'number' && 'text-right',
                  )}
                >
                  {isName ? (
                    <span className="text-text-secondary">
                      <span className="font-semibold tabular-nums text-text-primary">{items.length}</span> count
                    </span>
                  ) : (
                    <span className="tabular-nums text-text-muted">{filled.get(column.key) ?? 0} filled</span>
                  )}
                </td>
              );
            })}
            <td aria-hidden colSpan={2} className="bg-surface-1 p-0" />
          </tr>
        )}
        itemContent={(index, item) => {
            const typeColor = getTypeColor(item.type, nodeTypes);
            // What the row is, in the space's own words — the Type cell's
            // reading for a row wearing no alias.
            const typeLabel = getNodeTypeConfig(item.type, nodeTypes).name;
            const alias = item.alias ? aliases?.find((a) => a.name === item.alias) : undefined;
            return (
              <>
                {columns.map((column) => {
                  const value = cellValue(item, column);
                  if (column.source === 'name') {
                    return (
                      <td
                        key={column.key}
                        className={clsx(
                          'sticky left-0 z-10 border-r border-border-subtle p-0 align-middle transition-colors group-hover:bg-surface-2',
                          litKey === column.key ? 'bg-surface-2' : 'bg-surface-1',
                        )}
                      >
                        <div className="flex h-11 min-w-0 items-center gap-2.5 pl-3 pr-1">
                          <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-text-muted">{index + 1}</span>
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
                    <td key={column.key} className={clsx('h-11 border-r border-border-subtle p-0 align-middle', litKey === column.key && 'bg-surface-2')}>
                      <TableCell
                        column={column}
                        value={value}
                        aliasColor={alias?.color ?? typeColor}
                        typeLabel={typeLabel}
                        tagColors={tagColors}
                        onSave={onSaveCell && column.editable ? (v) => onSaveCell(item, column, v) : undefined}
                      />
                    </td>
                  );
                })}
                <td aria-hidden colSpan={2} className="p-0" />
              </>
            );
        }}
      />

      <HeaderPopover anchor={menu?.anchor ?? null} onClose={closeMenus}>
        {menuColumn && (
          <ColumnHeaderMenu
            column={menuColumn}
            typeName={typeName}
            sort={sort}
            canMoveLeft={menuIndex > 0}
            canMoveRight={menuIndex >= 0 && menuIndex < columns.length - 1}
            fields={fields}
            onSort={onSortChange}
            onMove={(dir) => {
              // Step over the visible neighbour, whatever hidden columns sit
              // between: land in front of it (left) or past it (right).
              const target = dir === -1 ? columns[menuIndex - 1] : columns[menuIndex + 2];
              onReorder(menuColumn.key, target?.key ?? null);
            }}
            onHide={() => onHideColumn(menuColumn.key)}
            onRemove={() => setRemoving(menuColumn)}
            onClose={closeMenus}
          />
        )}
      </HeaderPopover>

      <HeaderPopover anchor={addAnchor} onClose={closeMenus}>
        <AddColumnMenu
          typeName={typeName}
          hiddenColumns={hiddenColumns}
          fields={fields}
          onShow={onShowColumn}
          onClose={closeMenus}
        />
      </HeaderPopover>

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Stop tracking “${removing.label}”?` : ''}
        body={
          <>
            The column goes for everyone in the space. Values already entered stay on each entry&apos;s record and
            note — nothing is deleted — but nobody sees or edits them here until the field is tracked again.
          </>
        }
        confirmLabel="Stop tracking"
        destructive
        error={fields?.error ?? undefined}
        onConfirm={async () => {
          if (!removing || !fields) return;
          const ok = await fields.remove(removing.key);
          if (ok) setRemoving(null);
        }}
        onClose={() => { setRemoving(null); fields?.clearError(); }}
      />
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
