'use client';

// Attio's filter: one Filter button opening the fields, a field opening its
// values, and every narrowed field standing on the bar as a chip —
// `Channel is #design ×`. Pressing a chip reopens that field; its × puts the
// field back to rest.

import { useRef, useState } from 'react';
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
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ListFilterIcon, XIcon } from '@/features/shared/icons';
import type { FilterOption } from '@/features/resources/components/FilterMenu';

export interface FilterField {
  id: string;
  label: string;
  /** The word between field and value on its chip. */
  verb?: string;
  options: FilterOption[];
  value: string;
  /** The value that filters nothing; defaults to the first option. */
  restingId?: string;
  onChange: (id: string) => void;
}

const resting = (f: FilterField) => f.restingId ?? f.options[0]?.id;

export default function FilterBar({ fields }: { fields: FilterField[] }) {
  const [open, setOpen] = useState(false);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setFieldId(null);
    setQuery('');
  };
  useClickOutside(ref, close);

  const field = fields.find((f) => f.id === fieldId) ?? null;
  const q = query.trim().toLowerCase();
  const rows: Array<{ id: string; label: string; leading?: React.ReactNode }> = field
    ? field.options
    : fields.map((f) => ({ id: f.id, label: f.label }));
  const shown = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;

  const choose = (id: string) => {
    if (field) {
      field.onChange(id);
      close();
    } else {
      setFieldId(id);
      setQuery('');
    }
  };
  const cursor = useSearchMenuCursor({
    count: shown.length,
    resetKey: `${fieldId}:${q}`,
    onChoose: (i) => shown[i] && choose(shown[i].id),
    onClose: close,
  });

  const active = fields.filter((f) => f.value !== resting(f));
  const openField = (id: string | null) => {
    setFieldId(id);
    setQuery('');
    setOpen(true);
  };

  return (
    <div ref={ref} className="relative flex flex-wrap items-stretch gap-2 self-stretch">
      {active.map((f) => {
        const current = f.options.find((o) => o.id === f.value);
        return (
          <div key={f.id} className="flex min-h-10 items-center rounded-lg bg-surface-muted text-sm ring-1 ring-line">
            <button
              type="button"
              onClick={() => openField(f.id)}
              className="flex items-center gap-1.5 self-stretch rounded-l-lg pl-3 pr-2 hover:bg-surface-subtle"
            >
              <span className="text-fg-muted">{f.label}</span>
              {f.verb !== '' && <span className="text-fg-muted">{f.verb ?? 'is'}</span>}
              {current?.leading}
              <span className="font-semibold text-fg">{current?.label ?? f.value}</span>
            </button>
            <button
              type="button"
              aria-label={`Clear ${f.label}`}
              onClick={() => f.onChange(resting(f)!)}
              className="flex items-center self-stretch rounded-r-lg border-l border-line-subtle px-2 text-fg-muted hover:bg-surface-subtle hover:text-fg"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => (open ? close() : openField(null))}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold ring-1 transition-[box-shadow,background-color]',
          'bg-surface text-fg ring-line-subtle',
          open ? 'ring-line' : 'hover:bg-surface-subtle hover:ring-line',
        )}
      >
        <ListFilterIcon className="h-4 w-4 text-fg-muted" />
        Filter
      </button>

      {open && (
        <div className={clsx(SEARCH_MENU_PANEL, 'absolute left-0 top-full z-20 mt-1.5 w-[260px]')} role="menu">
          {field && (
            <button
              type="button"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Backspace') openField(null);
                else cursor.onKeyDown(e);
              }}
              onClick={() => openField(null)}
              className="flex w-full items-center gap-1.5 border-b border-line-subtle px-4 py-2 text-left text-xs font-semibold text-fg-muted hover:text-fg"
            >
              <ChevronLeftIcon className="h-3.5 w-3.5" />
              {field.label}
            </button>
          )}
          {!field && (
            <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Filter by…" />
          )}
          <SearchMenuList active={cursor.active} className="max-h-[440px]">
            {shown.length === 0 && <SearchMenuEmpty />}
            {shown.map((row, i) => {
              const picked = field ? row.id === field.value : false;
              const narrowed = !field && active.some((f) => f.id === row.id);
              return (
                <button
                  key={row.id}
                  type="button"
                  role={field ? 'menuitemradio' : 'menuitem'}
                  aria-checked={field ? picked : undefined}
                  data-menu-row={i}
                  onMouseEnter={() => cursor.setActive(i)}
                  onClick={() => choose(row.id)}
                  className={clsx(SEARCH_MENU_ROW, searchMenuRowState(i === cursor.active))}
                >
                  {row.leading}
                  <span className={clsx('min-w-0 flex-1 truncate', picked || narrowed ? 'font-semibold text-fg' : 'text-fg-secondary')}>
                    {row.label}
                  </span>
                  {picked && <CheckIcon className="h-4 w-4 shrink-0 text-fg-muted" />}
                  {!field && <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />}
                </button>
              );
            })}
          </SearchMenuList>
        </div>
      )}
    </div>
  );
}
