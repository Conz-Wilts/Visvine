'use client';

// The Grid bar's tag filter, drawn as TypeMenu's sibling so the two read as
// one family: a box the height of the search input, filled in the tag's own
// colour when exactly one tag is on, opening a menu of every tag with rows,
// each drawn as its chip with its count. All first clears the filter.
//
// Unlike the type, tags stack — a row toggles and the menu stays open, so
// several can be picked in one visit; the chip row under the bar restates
// them. A search box heads the list, since a space's tags outgrow reading
// down; it narrows the rows only, never the selection.

import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import { DROPDOWN_MENU_CLASS } from '@/components/ui/Dropdown';
import Chip from '@/components/ui/Chip';
import SearchInput from '@/components/ui/SearchInput';
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

  if (tags.length === 0) return null;

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
              'bg-surface-1 text-text-primary ring-1 hover:bg-surface-2 hover:ring-border-default',
              open || picked.length > 1 ? 'ring-border-default' : 'ring-border-subtle',
            ),
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{triggerLabel}</span>
        {triggerCount !== undefined && (
          <span className={clsx('text-[11px] leading-4 font-semibold tabular-nums', fill ? 'text-white/80' : 'text-text-muted')}>{triggerCount}</span>
        )}
        <ChevronDownIcon className={clsx('ml-1 h-3.5 w-3.5 transition-transform', fill ? 'text-white' : 'text-text-muted', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={clsx(DROPDOWN_MENU_CLASS, 'w-[300px]')} role="menu">
          <div
            className="border-b border-border-subtle p-2"
            onKeyDown={(e) => {
              // Enter toggles the first tag left standing; the menu stays open.
              if (e.key === 'Enter' && q && shown[0]) { e.preventDefault(); toggle(shown[0].name); }
              if (e.key === 'Escape') close();
            }}
          >
            <SearchInput value={query} onChange={setQuery} placeholder="Search tags…" size="md" autoFocus />
          </div>
          <div className="max-h-[440px] overflow-y-auto overscroll-contain py-1 custom-scrollbar">
            {q && shown.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-text-muted">Nothing matches “{query.trim()}”</p>
            )}
            {!q && <button
              type="button"
              role="menuitemradio"
              aria-checked={picked.length === 0}
              onClick={() => { onChange(new Set()); close(); }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1 text-left">
                <span className={clsx('px-2 text-[12px] font-semibold', picked.length === 0 ? 'text-text-primary' : 'text-text-secondary')}>
                  All
                </span>
              </span>
              <span className="shrink-0 text-[11px] leading-4 tabular-nums text-text-muted">{total}</span>
            </button>}
            {shown.map((tag) => {
              const on = selected.has(tag.name);
              return (
                <button
                  key={tag.name}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => toggle(tag.name)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 text-left">
                    <Chip
                      color={getColor(tag.name)}
                      size="md"
                      className={clsx(on && 'ring-2 ring-border-default ring-offset-1 ring-offset-surface-1')}
                    >
                      <span className="truncate">{tag.name}</span>
                    </Chip>
                  </span>
                  <span className="shrink-0 text-[11px] leading-4 tabular-nums text-text-muted">{tag.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
