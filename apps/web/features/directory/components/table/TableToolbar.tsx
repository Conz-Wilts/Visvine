'use client';

// The Table view's control bar, one quiet line: search, then the three menus
// that act on the table — Filter, Sort, Columns — then the active filters as
// removable pills. Which table you are in is the TypeStrip above the bar, not
// a control on it. Search rides the same line, sized to the buttons beside it
// — the Table names what it is showing and narrows it from one bar, so a
// full-width search band above would be a second bar doing the same job. The
// shape is the data-grid one (Attio, Linear): every control is a small text
// button that only shows chrome when it has something to say, so the resting
// bar is almost empty.
//
// "+ Filter" holds the current type's aliases and its tags, and sort is the
// same state the table header cycles (`view.sort`), restated as a menu so the
// current order is legible without scanning header arrows.
//
// All filter state lives in the passed-in useDirectoryBrowse() instance;
// sort belongs to the viewer's table view (useTableView).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import SearchInput from '@/components/ui/SearchInput';
import { DROPDOWN_MENU_CLASS } from '@/components/ui/Dropdown';
import Chip from '@/components/ui/Chip';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from '@/features/shared/icons';
import { tagPalette } from '@/lib/tagColors';
import type { SpaceAlias } from '@/lib/types';
import type { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import type { TableColumn, TableSort } from '@/lib/directory/table';

/** The bar's one button shape: borderless, hover fill, 36px tall, so it stands
 *  the same height as the `md` search field beside it. */
export const TABLE_TOOLBAR_BTN =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13.5px] font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary';

/** Icon size on the bar's own controls. The same glyphs inside the menus those
 *  buttons open stay small: a menu row is a list item, not a control on a bar. */
export const TABLE_TOOLBAR_ICON = 'h-[18px] w-[18px]';

interface TableToolbarProps {
  browse: ReturnType<typeof useDirectoryBrowse>;
  /** The current type's id — the `?type=` value; `all` for every row. */
  typeKey: string;
  /** The columns the sort menu offers (the visible ones). */
  columns: TableColumn[];
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  /** The view's Columns menu, at the right end. */
  trailing?: ReactNode;
  /** The tag filter's options, when the table's rows are not directory nodes (Agents). */
  tagOptions?: string[];
  /** Named for the type on show — "Search founders…". */
  searchPlaceholder: string;
}

export default function TableToolbar({ browse, typeKey, columns, sort, onSortChange, trailing, tagOptions, searchPlaceholder }: TableToolbarProps) {
  const {
    nodes, space,
    searchTerm, setSearchTerm,
    filterAliases, setFilterAliases,
    filterTags, setFilterTags,
  } = browse;

  const aliases = (space?.aliases ?? []) as SpaceAlias[];
  const tagColors = space?.designConfig?.tagColors ?? null;

  // Options and counts come from this type's rows: a tag no Person wears
  // would only ever filter the People table to nothing.
  const all = typeKey === 'all';
  const typeNodes = all ? nodes : nodes.filter((n) => n.type.toLowerCase() === typeKey);
  const typeAliases = all ? aliases : aliases.filter((a) => a.nodeType.toLowerCase() === typeKey);
  const typeTags = tagOptions ?? [...new Set(typeNodes.flatMap((n) => n.tags ?? []))].sort();

  const aliasColor = (name: string) => typeAliases.find((a) => a.name === name)?.color ?? 'var(--color-brand-green)';
  const tagColor = (tag: string) => tagPalette(tag, tagColors).base;

  const without = (set: Set<string>, value: string) => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };

  const activeCount = filterAliases.size + filterTags.size;

  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 pt-1">
      {/* Search leads the bar, then the three menus that act on the table -
          Filter, Sort, Columns - as one run, because they are one job; nothing
          is parked at the far end. The active filters trail them as removable
          chips. */}
      <SearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder={searchPlaceholder}
        size="md"
        // The width the context tree's box comes out at: its 300px column less
        // the 16px of padding either side. Same height, same width, so the two
        // read as one control appearing in two places rather than two controls.
        className="w-[284px] shrink-0"
      />

      <FilterMenu
        aliases={typeAliases
          .map((a) => ({
            value: a.name,
            color: a.color ?? 'var(--color-brand-green)',
            count: typeNodes.filter((n) => n.alias === a.name).length,
          }))
          // An alias nobody in the type wears would only filter to nothing;
          // a selected one stays listed so it can be unticked.
          .filter((a) => a.count > 0 || filterAliases.has(a.value))}
        selectedAliases={filterAliases}
        onChangeAliases={setFilterAliases}
        tags={typeTags.map((t) => ({
          value: t,
          color: tagColor(t),
          count: typeNodes.filter((n) => (n.tags ?? []).includes(t)).length,
        }))}
        selectedTags={filterTags}
        onChangeTags={setFilterTags}
      />

      <SortMenu columns={columns} sort={sort} onChange={onSortChange} />
      {trailing}

      {[...filterAliases].map((alias) => (
        <Chip key={`alias-${alias}`} color={aliasColor(alias)} onRemove={() => setFilterAliases(without(filterAliases, alias))} removeLabel={`Remove ${alias} filter`}>
          {alias}
        </Chip>
      ))}
      {[...filterTags].map((tag) => (
        <Chip key={`tag-${tag}`} color={tagColor(tag)} onRemove={() => setFilterTags(without(filterTags, tag))} removeLabel={`Remove ${tag} filter`}>
          {tag}
        </Chip>
      ))}
      {activeCount > 1 && (
        <button
          type="button"
          onClick={() => { setFilterAliases(new Set()); setFilterTags(new Set()); }}
          className="text-[12px] font-medium text-text-muted transition-colors hover:text-text-secondary"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ── Sort: the table's order, stated and settable ─────────────────────────────

function SortMenu({ columns, sort, onChange }: {
  columns: TableColumn[];
  sort: TableSort | null;
  onChange: (sort: TableSort | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const active = sort ? columns.find((c) => c.key === sort.key) : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={TABLE_TOOLBAR_BTN}
        style={active ? { color: 'var(--color-brand-dark-green)' } : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {active && sort ? (
          <>
            {sort.dir === 'asc' ? <ArrowUpIcon className={TABLE_TOOLBAR_ICON} /> : <ArrowDownIcon className={TABLE_TOOLBAR_ICON} />}
            <span>Sorted by {active.label}</span>
          </>
        ) : (
          <>
            <ChevronsUpDownIcon className={TABLE_TOOLBAR_ICON} />
            <span>Sort</span>
          </>
        )}
      </button>

      {open && (
        <div className={clsx(DROPDOWN_MENU_CLASS, 'left-auto right-0 w-[220px]')} role="menu">
          <div className="max-h-[320px] overflow-y-auto overscroll-contain custom-scrollbar">
            {columns.map((column) => {
              const isActive = sort?.key === column.key;
              return (
                <button
                  key={column.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => onChange({ key: column.key, dir: isActive && sort?.dir === 'asc' ? 'desc' : 'asc' })}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-[13px] transition-colors hover:bg-surface-2"
                >
                  <span className={clsx('min-w-0 flex-1 truncate text-left', isActive ? 'font-medium text-text-primary' : 'text-text-secondary')}>
                    {column.label}
                  </span>
                  {isActive && sort && (
                    // Clicking the active row flips it; the arrow says which way it points now.
                    sort.dir === 'asc'
                      ? <ArrowUpIcon className="h-3.5 w-3.5 shrink-0 text-brand-green" />
                      : <ArrowDownIcon className="h-3.5 w-3.5 shrink-0 text-brand-green" />
                  )}
                </button>
              );
            })}
          </div>
          {sort && (
            <div className="border-t border-border-subtle px-1.5 py-1">
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
              >
                <XIcon className="h-3.5 w-3.5" />
                Remove sort
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Filter: the type's aliases, then its tags ────────────────────────────────

interface FilterOption {
  value: string;
  color: string;
  count: number;
}

function FilterMenu({ aliases, selectedAliases, onChangeAliases, tags, selectedTags, onChangeTags }: {
  aliases: FilterOption[];
  selectedAliases: Set<string>;
  onChangeAliases: (next: Set<string>) => void;
  tags: FilterOption[];
  selectedTags: Set<string>;
  onChangeTags: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useClickOutside(ref, () => { setOpen(false); setSearch(''); });

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
    else setSearch('');
  }, [open]);

  const query = search.trim().toLowerCase();
  const matches = (o: FilterOption) => !query || o.value.toLowerCase().includes(query);
  const shownAliases = aliases.filter(matches);
  const shownTags = tags.filter(matches);
  const empty = aliases.length === 0 && tags.length === 0;

  const toggleIn = (set: Set<string>, value: string, onChange: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const row = (opt: FilterOption, checked: boolean, onToggle: () => void) => (
    <button
      key={opt.value}
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 px-3.5 py-1.5 transition-colors hover:bg-surface-2"
    >
      <span className="flex min-w-0 flex-1 justify-start">
        <Chip color={opt.color} size="sm">{opt.value}</Chip>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{opt.count}</span>
      <span
        className={clsx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded transition-colors', !checked && 'border-[1.5px] border-border-default bg-surface-1')}
        style={checked ? { backgroundColor: opt.color } : undefined}
      >
        {checked && <CheckIcon className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
      </span>
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={TABLE_TOOLBAR_BTN}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PlusIcon className={TABLE_TOOLBAR_ICON} />
        <span>Filter</span>
      </button>

      {open && (
        <div className={clsx(DROPDOWN_MENU_CLASS, 'w-[240px]')} role="menu">
          {empty ? (
            <p className="px-3.5 py-2.5 text-xs text-text-muted">Nothing to filter by yet — aliases and tags show up here.</p>
          ) : (
            <>
              <div className="px-2 pb-1 pt-1.5">
                <div className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1.5">
                  <SearchIcon className="h-3 w-3 shrink-0 text-text-muted" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter…"
                    className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
              </div>
              <div className="max-h-[320px] overflow-x-hidden overflow-y-auto overscroll-contain custom-scrollbar py-1">
                {shownAliases.length > 0 && (
                  <>
                    <p className="px-3.5 pb-1 pt-1.5 text-[11px] font-medium text-text-muted">Type</p>
                    {shownAliases.map((opt) => row(opt, selectedAliases.has(opt.value), () => toggleIn(selectedAliases, opt.value, onChangeAliases)))}
                  </>
                )}
                {shownTags.length > 0 && (
                  <>
                    <p className={clsx('px-3.5 pb-1 pt-1.5 text-[11px] font-medium text-text-muted', shownAliases.length > 0 && 'mt-1 border-t border-border-subtle pt-2.5')}>Tags</p>
                    {shownTags.map((opt) => row(opt, selectedTags.has(opt.value), () => toggleIn(selectedTags, opt.value, onChangeTags)))}
                  </>
                )}
                {shownAliases.length === 0 && shownTags.length === 0 && <p className="px-3.5 py-2.5 text-xs text-text-muted">No matches</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
