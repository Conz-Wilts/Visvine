'use client';

// The Grid bar's tag filter, drawn as TypeMenu's sibling so the two read as
// one family: a box the height of the search input, filled in the tag's own
// colour when exactly one tag is on, opening a menu of every tag with rows,
// each drawn as its chip with its count. All first clears the filter.
//
// Unlike the type, tags stack — a row toggles and the menu stays open, so
// several can be picked in one visit; the chip row under the bar restates
// them. The menu is the shared search menu (components/ui/SearchMenu), since
// a space's tags outgrow reading down; the search narrows the rows only,
// never the selection.

import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import Chip from '@/components/ui/Chip';
import {
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  SearchMenuInput,
  SearchMenuList,
  searchMenuRowState,
  useSearchMenuCursor,
} from '@/components/ui/SearchMenu';
import { ChevronDownIcon } from '@/features/shared/icons';

export interface MenuTag {
  name: string;
  count: number;
}

export default function TagMenu({ tags, selected, total, getColor, onChange }: {
  tags: MenuTag[];
  selected: Set<string>;
  /** The All row's count: every row, tagged or not. */
  total: number;
  getColor: (tag: string) => string;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setQuery(''); };
  useClickOutside(ref, close);

  const q = query.trim().toLowerCase();
  const shown = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;

  const picked = [...selected];
  const single = picked.length === 1 ? picked[0] : null;
  const fill = single ? getColor(single) : undefined;
  const triggerLabel = picked.length === 0 ? 'All Tags' : single ?? `${picked.length} Tags`;
  const triggerCount = single ? tags.find((t) => t.name === single)?.count : picked.length === 0 ? total : undefined;

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  // All heads the list until a search narrows it; then only tags are rows.
  const rows: Array<{ kind: 'all' } | { kind: 'tag'; tag: MenuTag }> = [
    ...(q ? [] : [{ kind: 'all' as const }]),
    ...shown.map((tag) => ({ kind: 'tag' as const, tag })),
  ];
  // A tag toggles and the menu stays open; All clears and closes.
  const choose = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === 'all') { onChange(new Set()); close(); }
    else toggle(row.tag.name);
  };
  const cursor = useSearchMenuCursor({ count: rows.length, resetKey: q, onChoose: choose, onClose: close });

  if (tags.length === 0) return null;

  return (
    <div ref={ref} className="relative flex self-stretch">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        style={fill ? { background: fill } : undefined}
        className={clsx(
          'flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-[box-shadow,background-color,filter]',
          fill
            ? clsx('text-white hover:brightness-95', open && 'brightness-95')
            : clsx(
              'bg-surface text-fg ring-1 hover:bg-surface-subtle hover:ring-line',
              open || picked.length > 1 ? 'ring-line' : 'ring-line-subtle',
            ),
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{triggerLabel}</span>
        {triggerCount !== undefined && (
          <span className={clsx('text-[11px] leading-4 font-semibold tabular-nums', fill ? 'text-white/80' : 'text-fg-muted')}>{triggerCount}</span>
        )}
        <ChevronDownIcon className={clsx('ml-1 h-3.5 w-3.5 transition-transform', fill ? 'text-white' : 'text-fg-muted', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={clsx(SEARCH_MENU_PANEL, 'absolute left-0 top-full mt-1.5 w-[300px]')} role="menu">
          <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Search tags…" />
          <SearchMenuList active={cursor.active} className="max-h-[440px]">
            {q && shown.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-fg-muted">Nothing matches “{query.trim()}”</p>
            )}
            {rows.map((row, i) => {
              const on = row.kind === 'all' ? picked.length === 0 : selected.has(row.tag.name);
              return (
                <button
                  key={row.kind === 'all' ? ':all:' : row.tag.name}
                  type="button"
                  role={row.kind === 'all' ? 'menuitemradio' : 'menuitemcheckbox'}
                  aria-checked={on}
                  data-menu-row={i}
                  onMouseEnter={() => cursor.setActive(i)}
                  onClick={() => choose(i)}
                  className={clsx(SEARCH_MENU_ROW, searchMenuRowState(i === cursor.active))}
                >
                  <span className="min-w-0 flex-1 text-left">
                    {row.kind === 'all' ? (
                      <span className={clsx('px-2 text-[12px] font-semibold', on ? 'text-fg' : 'text-fg-secondary')}>
                        All
                      </span>
                    ) : (
                      <Chip
                        color={getColor(row.tag.name)}
                        size="md"
                        className={clsx(on && 'ring-2 ring-line ring-offset-1 ring-offset-surface')}
                      >
                        <span className="truncate">{row.tag.name}</span>
                      </Chip>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] leading-4 tabular-nums text-fg-muted">
                    {row.kind === 'all' ? total : row.tag.count}
                  </span>
                </button>
              );
            })}
          </SearchMenuList>
        </div>
      )}
    </div>
  );
}
