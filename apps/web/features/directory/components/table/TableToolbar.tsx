'use client';

// The Table view's control bar, one quiet line: the type menu on the left
// (the table is per type, so the menu is the view switcher — each type row
// opens to its aliases, so "Founders" is one pick, not two), then active
// filters as removable pills beside a "+ Filter" menu; search, sort and the
// view's Columns menu on the right. The shape is the data-grid one (Attio,
// Linear): every control is a small text button that only shows chrome when
// it has something to say, so the resting bar is almost empty.
//
// "+ Filter" holds the tags — aliases live under their type in the type
// menu — and sort is the same state the table header cycles (`view.sort`),
// restated as a menu so the current order is legible without scanning
// header arrows.
//
// All filter state lives in the passed-in useDirectoryBrowse() instance;
// sort belongs to the viewer's table view (useTableView).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import { DROPDOWN_MENU_CLASS } from '@/components/ui/Dropdown';
import Chip from '@/components/ui/Chip';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from '@/features/shared/icons';
import { tagPalette } from '@/lib/tagColors';
import type { SpaceAlias } from '@/lib/types';
import type { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import type { TableColumn, TableSort } from '@/lib/directory/table';

/** The bar's one button shape — borderless, hover fill, 28px tall. */
export const TABLE_TOOLBAR_BTN =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary';

interface TableType {
  /** Lowercased id, the `?type=` value. */
  id: string;
  name: string;
  count: number;
}

interface TableToolbarProps {
  browse: ReturnType<typeof useDirectoryBrowse>;
  /** Every type with rows, for the type menu. */
  types: TableType[];
  /** The current type — whose aliases the type menu offers, whose rows are counted. */
  typeName: string;
  onTypeChange: (type: string) => void;
  /** The columns the sort menu offers (the visible ones). */
  columns: TableColumn[];
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  /** The view's Columns menu, at the right end. */
  trailing?: ReactNode;
}

export default function TableToolbar({ browse, types, typeName, onTypeChange, columns, sort, onSortChange, trailing }: TableToolbarProps) {
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
  const typeKey = typeName.toLowerCase();
  const typeNodes = nodes.filter((n) => n.type.toLowerCase() === typeKey);
  const typeAliases = aliases.filter((a) => a.nodeType.toLowerCase() === typeKey);
  const typeTags = [...new Set(typeNodes.flatMap((n) => n.tags ?? []))].sort();

  const aliasColor = (name: string) => typeAliases.find((a) => a.name === name)?.color ?? 'var(--color-brand-green)';
  const tagColor = (tag: string) => tagPalette(tag, tagColors).base;

  const without = (set: Set<string>, value: string) => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };

  const activeCount = filterAliases.size + filterTags.size;

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1.5">
      <TypeMenu
        types={types}
        activeName={typeName}
        nodes={nodes}
        aliases={aliases}
        selectedAliases={filterAliases}
        onChangeAliases={setFilterAliases}
        onTypeChange={onTypeChange}
      />

      <div className="h-4 w-px shrink-0 bg-border-subtle" />

      <FilterMenu
        tags={typeTags.map((t) => ({
          value: t,
          color: tagColor(t),
          count: typeNodes.filter((n) => (n.tags ?? []).includes(t)).length,
        }))}
        selectedTags={filterTags}
        onChangeTags={setFilterTags}
      />

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

      <div className="ml-auto flex items-center gap-1">
        <ToolbarSearch value={searchTerm} onChange={setSearchTerm} typeName={typeName} />
        <SortMenu columns={columns} sort={sort} onChange={onSortChange} />
        {trailing}
      </div>
    </div>
  );
}

// ── Search: an icon until it has something to hold ───────────────────────────

function ToolbarSearch({ value, onChange, typeName }: {
  value: string;
  onChange: (value: string) => void;
  typeName: string;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || value.length > 0;

  if (!expanded) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={TABLE_TOOLBAR_BTN} aria-label="Search the table">
        <SearchIcon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="flex h-7 w-[200px] items-center gap-1.5 rounded-md bg-surface-2 px-2">
      <SearchIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (!value) setOpen(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { onChange(''); setOpen(false); } }}
        placeholder={`Search ${typeName.toLowerCase()}s…`}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
        aria-label="Search the table"
      />
      {value && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          className="shrink-0 text-text-muted transition-colors hover:text-text-secondary"
          aria-label="Clear search"
        >
          <XIcon className="h-3.5 w-3.5" />
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
            {sort.dir === 'asc' ? <ArrowUpIcon className="h-3.5 w-3.5" /> : <ArrowDownIcon className="h-3.5 w-3.5" />}
            <span>Sorted by {active.label}</span>
          </>
        ) : (
          <>
            <ChevronsUpDownIcon className="h-4 w-4" />
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

// ── Type: which table, and which of its aliases ──────────────────────────────

function TypeMenu({ types, activeName, nodes, aliases, selectedAliases, onChangeAliases, onTypeChange }: {
  types: TableType[];
  activeName: string;
  nodes: ReturnType<typeof useDirectoryBrowse>['nodes'];
  aliases: SpaceAlias[];
  selectedAliases: Set<string>;
  onChangeAliases: (next: Set<string>) => void;
  onTypeChange: (type: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const activeKey = activeName.toLowerCase();
  const active = types.find((t) => t.id === activeKey);

  // The active type's aliases start open — they are the reason to look here.
  useEffect(() => {
    if (open) setExpanded(new Set([activeKey]));
  }, [open, activeKey]);

  const aliasesFor = (type: TableType) =>
    aliases
      .filter((a) => a.nodeType.toLowerCase() === type.id)
      .map((a) => ({
        name: a.name,
        color: a.color,
        count: nodes.filter((n) => n.type.toLowerCase() === type.id && n.alias === a.name).length,
      }))
      // An alias nobody in the type wears would only filter to nothing;
      // a selected one stays listed so it can be unticked.
      .filter((a) => a.count > 0 || (type.id === activeKey && selectedAliases.has(a.name)));

  const pickType = (type: TableType) => {
    if (type.id !== activeKey) {
      // The alias filter belonged to the old type's table.
      onChangeAliases(new Set());
      onTypeChange(type.id);
    }
    setOpen(false);
  };

  const pickAlias = (type: TableType, name: string) => {
    if (type.id !== activeKey) {
      onTypeChange(type.id);
      onChangeAliases(new Set([name]));
      setOpen(false);
      return;
    }
    const next = new Set(selectedAliases);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChangeAliases(next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-text-primary transition-colors hover:bg-surface-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{active?.name ?? activeName}</span>
        {active && <span className="font-normal tabular-nums text-text-muted">{active.count}</span>}
        <ChevronDownIcon className={clsx('h-3.5 w-3.5 text-text-muted transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={clsx(DROPDOWN_MENU_CLASS, 'w-[240px]')} role="menu">
          <div className="max-h-[360px] overflow-y-auto overscroll-contain custom-scrollbar py-1">
            {types.map((type) => {
              const isActive = type.id === activeKey;
              const typeAliases = aliasesFor(type);
              const isExpanded = expanded.has(type.id);
              return (
                <div key={type.id}>
                  <div className="flex w-full items-center">
                    {typeAliases.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(type.id)) next.delete(type.id);
                            else next.add(type.id);
                            return next;
                          })
                        }
                        className="flex shrink-0 items-center justify-center py-2 pl-2.5 pr-0.5 text-text-muted transition-colors hover:text-text-secondary"
                        aria-label={isExpanded ? `Hide ${type.name} aliases` : `Show ${type.name} aliases`}
                      >
                        <ChevronRightIcon className={clsx('h-3 w-3 transition-transform duration-150', isExpanded && 'rotate-90')} />
                      </button>
                    ) : (
                      <span className="w-6 shrink-0" aria-hidden />
                    )}
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => pickType(type)}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-0.5 pr-3.5 text-[13px] transition-colors hover:bg-surface-2"
                    >
                      <span className={clsx('min-w-0 flex-1 truncate text-left', isActive ? 'font-semibold text-text-primary' : 'text-text-secondary')}>
                        {type.name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{type.count}</span>
                      {isActive && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-brand-green" />}
                    </button>
                  </div>

                  {isExpanded &&
                    typeAliases.map((alias) => {
                      const checked = isActive && selectedAliases.has(alias.name);
                      return (
                        <button
                          key={alias.name}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={checked}
                          onClick={() => pickAlias(type, alias.name)}
                          className="flex w-full items-center gap-2.5 py-1.5 pl-8 pr-3.5 transition-colors hover:bg-surface-2"
                        >
                          <span className="flex min-w-0 flex-1 justify-start">
                            <Chip color={alias.color} size="sm">{alias.name}</Chip>
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{alias.count}</span>
                          <span
                            className={clsx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded transition-colors', !checked && 'border-[1.5px] border-border-default bg-surface-1')}
                            style={checked ? { backgroundColor: alias.color } : undefined}
                          >
                            {checked && <CheckIcon className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter: the tags ─────────────────────────────────────────────────────────

interface FilterOption {
  value: string;
  color: string;
  count: number;
}

function FilterMenu({ tags, selectedTags, onChangeTags }: {
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
  const shownTags = tags.filter((o) => !query || o.value.toLowerCase().includes(query));

  const toggle = (value: string) => {
    const next = new Set(selectedTags);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChangeTags(next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={TABLE_TOOLBAR_BTN}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PlusIcon className="h-3.5 w-3.5" />
        <span>Filter</span>
      </button>

      {open && (
        <div className={clsx(DROPDOWN_MENU_CLASS, 'w-[240px]')} role="menu">
          {tags.length === 0 ? (
            <p className="px-3.5 py-2.5 text-xs text-text-muted">Nothing to filter by yet — tags show up here.</p>
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
                    placeholder="Filter tags…"
                    className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
              </div>
              <div className="max-h-[300px] overflow-y-auto overscroll-contain custom-scrollbar py-1">
                {shownTags.map((opt) => {
                  const checked = selectedTags.has(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      onClick={() => toggle(opt.value)}
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
                })}
                {shownTags.length === 0 && <p className="px-3.5 py-2.5 text-xs text-text-muted">No matches</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
