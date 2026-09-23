import { useState } from 'react';
import {
  Avatar,
  Chip,
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  SearchMenuInput,
  SearchMenuList,
  searchMenuRowState,
  useSearchMenuCursor,
} from '@visvine/ui';

const PEOPLE = [
  { name: 'Ana Ruiz', role: 'Head of growth' },
  { name: 'Craig Tan', role: 'Sales lead' },
  { name: 'Priya Nair', role: 'Designer' },
  { name: 'Tomás Silva', role: 'Engineer' },
];

export const People = () => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = PEOPLE.filter((p) => p.name.toLowerCase().includes(q));
  const cursor = useSearchMenuCursor({ count: shown.length, resetKey: q, onChoose: () => {}, onClose: () => {} });
  return (
    <div className={`${SEARCH_MENU_PANEL} w-80`}>
      <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Search people…" autoFocus={false} />
      <SearchMenuList active={cursor.active}>
        {shown.map((p, i) => (
          <button
            key={p.name}
            type="button"
            data-menu-row={i}
            onMouseEnter={() => cursor.setActive(i)}
            className={`${SEARCH_MENU_ROW} ${searchMenuRowState(i === cursor.active)}`}
          >
            <Avatar name={p.name} size="xs" />
            <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
            <span className="shrink-0 text-xs text-fg-muted">{p.role}</span>
          </button>
        ))}
      </SearchMenuList>
    </div>
  );
};

const TAGS = [
  { name: 'customer', count: 42, color: 'var(--vv-color-hue-blue)' },
  { name: 'investor', count: 17, color: 'var(--vv-color-hue-green)' },
  { name: 'partner', count: 9, color: 'var(--vv-color-hue-amber)' },
  { name: 'press', count: 4, color: 'var(--vv-color-hue-pink)' },
];

export const TagsWithCounts = () => {
  const [query, setQuery] = useState('');
  const rows = [{ name: 'All', count: 118, color: null }, ...TAGS];
  const cursor = useSearchMenuCursor({ count: rows.length, resetKey: query, onChoose: () => {}, onClose: () => {} });
  return (
    <div className={`${SEARCH_MENU_PANEL} w-72`}>
      <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Search tags…" autoFocus={false} />
      <SearchMenuList active={cursor.active}>
        {rows.map((t, i) => (
          <button
            key={t.name}
            type="button"
            data-menu-row={i}
            onMouseEnter={() => cursor.setActive(i)}
            className={`${SEARCH_MENU_ROW} ${searchMenuRowState(i === cursor.active)}`}
          >
            <span className="min-w-0 flex-1 text-left">
              {t.color ? (
                <Chip size="md" color={t.color}>{t.name}</Chip>
              ) : (
                <span className="px-2 text-[12px] font-semibold text-fg">All</span>
              )}
            </span>
            <span className="shrink-0 text-[11px] leading-4 tabular-nums text-fg-muted">{t.count}</span>
          </button>
        ))}
      </SearchMenuList>
    </div>
  );
};

const CHANNELS = ['announcements', 'growth', 'launch-night', 'partnerships', 'sales-pipeline', 'standup-digest', 'support', 'weekly-review'];

export const Scrolling = () => (
  <div className={`${SEARCH_MENU_PANEL} w-72`}>
    <SearchMenuInput value="" onChange={() => {}} placeholder="Jump to a channel…" autoFocus={false} />
    <SearchMenuList active={5} className="max-h-[140px]">
      {CHANNELS.map((c, i) => (
        <button key={c} type="button" data-menu-row={i} className={`${SEARCH_MENU_ROW} ${searchMenuRowState(i === 5)}`}>
          <span className="text-fg-muted">#</span>
          <span className="truncate text-fg">{c}</span>
        </button>
      ))}
    </SearchMenuList>
  </div>
);
