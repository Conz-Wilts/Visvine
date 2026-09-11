'use client';

// The Directory as rows: one type at a time, one row per entry, one column
// per thing the type tracks. The shape is the spreadsheet one: a grid that
// fills its pane, with a numbered name column, each header wearing its kind's glyph and
// opening a menu of what can be done to the column — sort, step, hide, and
// an admin's edit — with the column it opened for lit under it; a drag
// reorders a column, its right edge resizes it, and "Add column" — the last
// column itself, filling the pane past the data — shows a hidden column or
// mints a new field without leaving the table.
// Columns nobody has sized share out the pane's spare width, so a table with
// few columns is never a strip beside a blank, and blank rows carry the grid
// past the last entry, so a short table fills its pane rather than stopping
// mid-screen. The table's own tfoot sits on the pane's bottom edge and counts
// what is there — with the horizontal scrollbar under it, since it is inside
// the scroll box.
//
// The box around it all is traced on the SCROLLPORT, as an overlay: four
// hairlines on the scroll box's own edges, inset past whatever the scrollbars
// take. Neither of the obvious places can draw it. A border on the pane's
// frame sits outside the scrollbars, so its right line stands clear of where
// every row line ends and its sides run on under the horizontal bar; a border
// on the cells rides the TABLE, which collapses its borders — the name
// column's left line and "Add column"'s right one are at the table's edges,
// and a table wider than the pane keeps both of them off screen.
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

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  /** The type's columns this view hides — the "Add column" menu's stock. */
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

/** The narrowest the "Add column" cell gets. It is the table's last column,
 *  not a button parked before a blank one, so it takes every pixel past the
 *  data and never less than this. */
const ADD_COLUMN_MIN_WIDTH = 168;

/** How far inside the scrollport an edge with no scrollbar draws its line. A
 *  hairline ON the scrollport's last pixel is the window's last pixel too, and
 *  reads as no line at all. */
const BOX_INSET = 1;

/** What the table's frame components need that a row's content doesn't: the
 *  column layout the `<colgroup>` is built from. */
interface TableContext {
  columns: TableColumn[];
  widthOf: (column: TableColumn) => number;
  totalWidth: number;
  /** Blank rows drawn under the last entry so the grid runs to the pane's
   *  bottom edge and the count row sits on it. */
  fillerRows: number;
  /** The last blank row's height: a row's worth plus whatever the division
   *  left over, so the count row lands ON the bottom edge rather than a few
   *  pixels above it. */
  lastFillerHeight: number;
  /** The column an open header menu acts on, lit down its whole length. */
  litKey: string | null;
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
        {/* "Add column" is the last column and carries no width, so fixed
            layout hands it every pixel past the data: the gridlines end where
            the data does and the header still reaches the pane's edge. */}
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

// The count row rides INSIDE the scroll box, sticky to its bottom, so the
// horizontal scrollbar sits under it rather than between it and the rows —
// and it follows the columns sideways for free. z-20 for the same reason the
// head takes it: the body's sticky name cells are z-10.
const TableFoot = React.forwardRef<HTMLTableSectionElement, React.ComponentPropsWithoutRef<'tfoot'>>(
  function TableFoot({ style, ...props }, ref) {
    return <tfoot ref={ref} {...props} style={{ ...style, zIndex: 20 }} className="bg-surface-1" />;
  },
);

// The blank rows past the last entry. A table with three rows in a tall pane
// would otherwise end mid-screen with its count row hanging under it; the grid
// keeps going instead, empty, and the count lands on the pane's bottom edge.
// They are appended to the body rather than drawn as an overlay so they take
// the same colgroup, gridlines and sticky name column the real rows do — and
// they only exist when the data is SHORTER than the pane, which is exactly
// when nothing is virtualised.
const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.ComponentPropsWithoutRef<'tbody'> & { context?: TableContext }
>(function TableBody({ context, children, ...props }, ref) {
  const { columns = [], fillerRows = 0, lastFillerHeight = 0, litKey = null } = context ?? {};
  return (
    <tbody ref={ref} {...props}>
      {children}
      {Array.from({ length: fillerRows }).map((_, i) => (
        <tr
          key={`filler-${i}`}
          aria-hidden
          className="h-11 border-b border-border-subtle"
          style={i === fillerRows - 1 ? { height: lastFillerHeight } : undefined}
        >
          {columns.map((column, j) => (
            <td
              key={column.key}
              className={clsx(
                'border-r border-border-subtle p-0',
                litKey === column.key ? 'bg-surface-2' : 'bg-surface-1',
                j === 0 && column.source === 'name' && 'sticky left-0 z-10',
              )}
            />
          ))}
          <td className="bg-surface-1 p-0" />
        </tr>
      ))}
    </tbody>
  );
});

const TableRow = ({ item: _item, style, ...props }: React.ComponentPropsWithoutRef<'tr'> & { item?: DirectoryItem }) => (
  <tr
    {...props}
    style={style}
    className="group h-11 border-b border-border-subtle"
  />
);

const tableComponents = { Scroller, Table, TableHead, TableBody, TableFoot, TableRow } as unknown as TableComponents<DirectoryItem, TableContext>;

export default function DirectoryTable({
  items, columns, hiddenColumns, typeName, sort, widths, loading = false,
  nodeTypes, aliases, tagColors, fields,
  onSortChange, onResize, onReorder, onShowColumn, onHideColumn, onOpen, onSaveCell,
}: DirectoryTableProps) {
  // ── filling the pane: spare width goes to the columns nobody has sized ──
  // A table narrower than its pane would leave a blank strip past the last
  // column while the columns themselves truncate, so the slack is shared out
  // over the columns still at their default width, in proportion to those
  // widths. A column the viewer has dragged keeps the width they gave it; if
  // they have sized every one, the filler column past "+" takes the slack.
  const frameRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  // What the scrollbars take off the scroll box, so the box's lines can be
  // traced on the scrollport rather than around the bars. With no scrollbar
  // the pane runs to the window's own edge, where a hairline on the last pixel
  // row is clipped or lost to display scaling — so an edge with no bar to hide
  // behind is still held one pixel in (BOX_INSET).
  const [gutter, setGutter] = useState({ right: 0, bottom: 0 });
  // How many blank rows it takes to reach the pane's bottom edge, and how tall
  // the last of them is.
  const [filler, setFiller] = useState({ rows: 0, lastHeight: 0 });
  // The frame is behind the loading and empty returns below, so this waits for
  // it: with no dependency the one run happens while the skeleton is up, the
  // ref is null, and the gutters stay 0 — tracing the box around the
  // scrollbars rather than inside them.
  const mounted = !loading && items.length > 0;
  const itemCount = items.length;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const scroller = frame.querySelector<HTMLElement>('[data-virtuoso-scroller]');
      const box = scroller ?? frame;
      setPaneWidth(box.clientWidth);
      const next = {
        right: box.offsetWidth - box.clientWidth,
        bottom: box.offsetHeight - box.clientHeight,
      };
      setGutter((g) => (g.right === next.right && g.bottom === next.bottom ? g : next));

      // The blanks are counted from the parts, never from the table's own
      // height: the fillers are IN that height, so measuring it would feed
      // back on itself. Head, foot and one real row are enough.
      const headHeight = frame.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const footHeight = frame.querySelector('tfoot')?.getBoundingClientRect().height ?? 0;
      const rowHeight = frame.querySelector('tbody tr')?.getBoundingClientRect().height ?? 0;
      if (rowHeight <= 0) return;
      const spare = box.clientHeight - (next.bottom || BOX_INSET) - headHeight - footHeight - itemCount * rowHeight;
      // The division rarely comes out whole; the remainder goes on the last
      // blank row rather than as a strip of nothing under the count.
      const rows = spare < 2 ? 0 : Math.max(1, Math.floor(spare / rowHeight));
      const blanks = { rows, lastHeight: rows > 0 ? spare - (rows - 1) * rowHeight : 0 };
      setFiller((f) => (f.rows === blanks.rows && f.lastHeight === blanks.lastHeight ? f : blanks));
    };
    measure();
    // Both: the frame moves with the window, the scroll box also when a
    // scrollbar appears or goes — which is what the gutters are. The scroller
    // is Virtuoso's and may land a frame after this, so it is waited for.
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    let raf = 0;
    const attach = () => {
      const scroller = frame.querySelector<HTMLElement>('[data-virtuoso-scroller]');
      if (scroller) {
        observer.observe(scroller);
        measure();
      } else {
        raf = requestAnimationFrame(attach);
      }
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [mounted, itemCount, columns]);

  // ── resizing: a pointer drag on the header's right edge ────────────────
  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<{ key: string; width: number } | null>(null);
  const beginResize = (e: React.PointerEvent, column: TableColumn) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizing.current = { key: column.key, startX: e.clientX, startWidth: effectiveWidth(column) };
  };
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

  const effectiveWidth = useMemo(() => {
    const sized = (c: TableColumn) => (liveWidth?.key === c.key ? liveWidth.width : widths[c.key]);
    const base = (c: TableColumn) => sized(c) ?? defaultWidth(c);
    const total = columns.reduce((sum, c) => sum + base(c), 0) + ADD_COLUMN_MIN_WIDTH;
    const free = columns.filter((c) => sized(c) === undefined);
    const freeWidth = free.reduce((sum, c) => sum + base(c), 0);
    const slack = paneWidth - total;
    if (slack <= 0 || freeWidth === 0) return base;
    const widened = new Map(free.map((c) => [c.key, Math.min(MAX_COLUMN_WIDTH, Math.floor(base(c) + (slack * base(c)) / freeWidth))]));
    return (c: TableColumn) => widened.get(c.key) ?? base(c);
  }, [columns, liveWidth, paneWidth, widths]);
  const totalWidth = columns.reduce((sum, c) => sum + effectiveWidth(c), 0) + ADD_COLUMN_MIN_WIDTH;
  const tableContext = useMemo<TableContext>(
    () => ({
      columns,
      widthOf: effectiveWidth,
      totalWidth,
      fillerRows: filler.rows,
      lastFillerHeight: filler.lastHeight,
      litKey: menu?.key ?? null,
    }),
    [columns, effectiveWidth, filler, menu, totalWidth],
  );

  const menuColumn = menu ? columns.find((c) => c.key === menu.key) ?? null : null;
  const menuIndex = menuColumn ? columns.indexOf(menuColumn) : -1;
  // The column the open menu is for: lit down its whole length, so what the
  // menu acts on is never in doubt.
  const litKey = menu?.key ?? null;

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
    <div ref={frameRef} className="relative flex h-full w-full flex-col overflow-hidden bg-surface-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-30 border border-border-subtle"
        style={{ right: gutter.right || BOX_INSET, bottom: gutter.bottom || BOX_INSET }}
      />
      <div className="min-h-0 min-w-0 flex-1">
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
                  'bg-surface-1 p-0 text-left align-middle',
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
                  title="Add a column"
                  className={clsx(
                    'flex h-10 w-full items-center gap-2 px-3 text-[13px] font-medium text-text-muted transition-colors hover:text-text-primary',
                    addAnchor && 'text-text-primary',
                  )}
                >
                  <PlusIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">Add column</span>
                </button>
              </th>
            </tr>
          )}
          fixedFooterContent={() => (
            // The count row: how many entries there are, said once under the
            // name column. It is the table's own tfoot, so it sits on the
            // pane's bottom edge however few rows there are, slides with the
            // columns, and leaves the horizontal scrollbar below it. The name
            // cell holds still the way its column does.
            <tr className="h-10 border-t border-border-default text-[12.5px]">
              {columns.map((column, i) => (
                <td
                  key={column.key}
                  className={clsx(
                    'border-r border-border-subtle px-3 align-middle',
                    litKey === column.key ? 'bg-surface-2' : 'bg-surface-1',
                    i === 0 && column.source === 'name' && 'sticky left-0 z-10',
                    column.kind === 'number' && 'text-right',
                  )}
                >
                  {column.source === 'name' && (
                    <span className="text-text-secondary">
                      <span className="font-semibold tabular-nums text-text-primary">{items.length}</span> count
                    </span>
                  )}
                </td>
              ))}
              <td aria-hidden className="bg-surface-1 p-0" />
            </tr>
          )}
          itemContent={(_index, item) => {
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
                            // Opaque, always: surface-2 is a tint with alpha, so
                            // a hovered sticky cell painted in it would show the
                            // columns sliding underneath. The tint goes on as an
                            // image over an opaque surface-1 instead.
                            'sticky left-0 z-10 border-r border-border-subtle bg-surface-1 p-0 align-middle group-hover:bg-[image:linear-gradient(var(--color-surface-2),var(--color-surface-2))]',
                            litKey === column.key && 'bg-[image:linear-gradient(var(--color-surface-2),var(--color-surface-2))]',
                          )}
                        >
                          <NameCell
                            item={item}
                            accentColor={alias?.color ?? typeColor ?? undefined}
                            onOpen={() => onOpen(item)}
                            onRename={onSaveCell ? (next) => onSaveCell(item, column, next) : undefined}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={column.key}
                        className={clsx(
                          'h-11 border-r border-border-subtle p-0 align-middle group-hover:bg-surface-2',
                          litKey === column.key ? 'bg-surface-2' : 'bg-surface-1',
                        )}
                      >
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
                  <td aria-hidden className="bg-surface-1 p-0 group-hover:bg-surface-2" />
                </>
              );
          }}
        />
      </div>

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
/** The name cell: the entry's avatar and name (the click that opens it), and
 *  for a viewer who may rename it a pencil that swaps the name for an editor
 *  filling the rest of the cell. */
function NameCell({ item, accentColor, onOpen, onRename }: {
  item: DirectoryItem;
  accentColor: string | undefined;
  onOpen: () => void;
  onRename?: (next: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex h-11 min-w-0 items-center gap-2.5 pl-3 pr-1">
      <Avatar
        name={item.name}
        imageUrl={item.image_url}
        size="chip"
        accentColor={accentColor}
        fallback={item.type.toLowerCase() === 'person' ? 'silhouette' : 'initials'}
      />
      {editing && onRename ? (
        <div className="h-full min-w-0 flex-1">
          <TableCell
            column={{ key: 'name', label: 'Name', kind: 'text', source: 'name', origin: 'core', editable: true }}
            value={item.name}
            onSave={async (v) => {
              await onRename(v);
              setEditing(false);
            }}
            autoEdit
            onDone={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={onOpen}
            className="flex min-w-0 items-center text-left"
            title={`Open ${item.name}`}
          >
            <span className="truncate font-medium text-text-primary hover:underline">{item.name}</span>
          </button>
          {onRename && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={`Rename ${item.name}`}
              className="shrink-0 rounded p-1 text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
