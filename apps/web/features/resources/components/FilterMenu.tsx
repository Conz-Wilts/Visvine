'use client';

// One filter on the Resources bar, in the Directory's shape (TypeMenu): a
// box as tall as the search beside it that names what is on show, opening the
// shared search menu with every choice as a row. The resting choice reads as
// the plain box; anything narrower fills it, so a filtered list says so from
// the bar.

import { useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import {
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  SearchMenuEmpty,
  SearchMenuInput,
  SearchMenuList,
  searchMenuRowState,
  useSearchMenuCursor,
} from '@visvine/ui';
import { CheckIcon, ChevronDownIcon } from '@/features/shared/icons';

export interface FilterOption {
  id: string;
  label: string;
  /** Drawn before the label, in the row and on the trigger. */
  leading?: ReactNode;
}

export default function FilterMenu({ label, options, value, onChange, restingId }: {
  /** What the menu picks, for its search field and screen readers. */
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (id: string) => void;
  /** The choice that filters nothing; defaults to the first. */
  restingId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  useClickOutside(ref, close);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const pick = (id: string) => {
    onChange(id);
    close();
  };
  const cursor = useSearchMenuCursor({
    count: shown.length,
    resetKey: q,
    onChoose: (i) => {
      if (shown[i]) pick(shown[i].id);
    },
    onClose: close,
  });

  const current = options.find((o) => o.id === value) ?? options[0];
  if (!current) return null;
  const narrowed = current.id !== (restingId ?? options[0].id);

  return (
    <div ref={ref} className="relative flex self-stretch">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        className={clsx(
          'flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold ring-1 transition-[box-shadow,background-color]',
          narrowed ? 'bg-surface-muted text-fg ring-line' : 'bg-surface text-fg ring-line-subtle',
          open ? 'ring-line' : 'hover:bg-surface-subtle hover:ring-line',
        )}
      >
        {current.leading}
        <span className="truncate">{current.label}</span>
        <ChevronDownIcon className={clsx('ml-1 h-3.5 w-3.5 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={clsx(SEARCH_MENU_PANEL, 'absolute left-0 top-full mt-1.5 w-[260px]')} role="menu">
          <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder={`Search ${label.toLowerCase()}…`} />
          <SearchMenuList active={cursor.active} className="max-h-[440px]">
            {shown.length === 0 && <SearchMenuEmpty />}
            {shown.map((option, i) => {
              const picked = option.id === current.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={picked}
                  data-menu-row={i}
                  onMouseEnter={() => cursor.setActive(i)}
                  onClick={() => pick(option.id)}
                  className={clsx(SEARCH_MENU_ROW, searchMenuRowState(i === cursor.active))}
                >
                  {option.leading}
                  <span className={clsx('min-w-0 flex-1 truncate', picked ? 'font-semibold text-fg' : 'text-fg-secondary')}>
                    {option.label}
                  </span>
                  {picked && <CheckIcon className="h-4 w-4 shrink-0 text-fg-muted" />}
                </button>
              );
            })}
          </SearchMenuList>
        </div>
      )}
    </div>
  );
}
