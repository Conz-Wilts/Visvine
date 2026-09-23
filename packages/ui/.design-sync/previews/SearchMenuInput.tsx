import { useState } from 'react';
import {
  Avatar,
  Chip,
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  SearchMenuEmpty,
  SearchMenuInput,
  SearchMenuList,
  searchMenuRowState,
  useSearchMenuCursor,
} from '@visvine/ui';

const TYPES = [
  { name: 'Person', color: 'var(--vv-color-hue-blue)' },
  { name: 'Space', color: 'var(--vv-color-hue-green)' },
  { name: 'Event', color: 'var(--vv-color-hue-orange)' },
  { name: 'Resource', color: 'var(--vv-color-hue-indigo)' },
  { name: 'Meeting note', color: 'var(--vv-color-hue-pink)' },
];

export const TypePicker = () => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = TYPES.filter((t) => t.name.toLowerCase().includes(q));
  const rows = [...shown.map((t) => ({ kind: 'type' as const, t })), ...(q ? [] : [{ kind: 'clear' as const }])];
  const cursor = useSearchMenuCursor({ count: rows.length, resetKey: q, onChoose: () => {}, onClose: () => {} });
  return (
    <div className={`${SEARCH_MENU_PANEL} w-72`}>
      <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Search types…" autoFocus={false} />
      <SearchMenuList active={cursor.active}>
        {rows.length === 0 && <SearchMenuEmpty />}
        {rows.map((row, i) => (
          <button
            key={row.kind === 'type' ? row.t.name : ':clear:'}
            type="button"
            data-menu-row={i}
            onMouseEnter={() => cursor.setActive(i)}
            className={`${SEARCH_MENU_ROW} ${searchMenuRowState(i === cursor.active)}`}
          >
            {row.kind === 'type' ? (
              <Chip size="md" color={row.t.color}>{row.t.name}</Chip>
            ) : (
              <span className="text-fg-secondary">No type</span>
            )}
          </button>
        ))}
      </SearchMenuList>
    </div>
  );
};

const PEOPLE = [
  { name: 'Ana Ruiz', space: 'Growth team' },
  { name: 'Anand Mehta', space: 'Sales' },
  { name: 'Hana Kobayashi', space: 'Growth team' },
  { name: 'Craig Tan', space: 'Ops' },
];

export const WithQuery = () => {
  const [query, setQuery] = useState('an');
  const q = query.trim().toLowerCase();
  const shown = PEOPLE.filter((p) => p.name.toLowerCase().includes(q));
  const cursor = useSearchMenuCursor({ count: shown.length, resetKey: q, onChoose: () => {}, onClose: () => {} });
  return (
    <div className={`${SEARCH_MENU_PANEL} w-80`}>
      <SearchMenuInput
        value={query}
        onChange={setQuery}
        onKeyDown={cursor.onKeyDown}
        placeholder="Search people…"
        autoFocus={false}
        trailing={
          query ? (
            <button type="button" onClick={() => setQuery('')} className="text-xs font-semibold text-fg-muted hover:text-fg">
              Clear
            </button>
          ) : null
        }
      />
      <SearchMenuList active={cursor.active}>
        {shown.length === 0 && <SearchMenuEmpty />}
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
            <span className="shrink-0 text-xs text-fg-muted">{p.space}</span>
          </button>
        ))}
      </SearchMenuList>
    </div>
  );
};

export const EmptyField = () => (
  <div className={`${SEARCH_MENU_PANEL} w-72`}>
    <SearchMenuInput value="" onChange={() => {}} placeholder="Link a note…" autoFocus={false} />
    <SearchMenuList>
      {['Q3 launch plan', 'Standup digest', 'HubSpot setup'].map((title, i) => (
        <button key={title} type="button" data-menu-row={i} className={`${SEARCH_MENU_ROW} ${searchMenuRowState(false)}`}>
          <span className="truncate text-fg">{title}</span>
        </button>
      ))}
    </SearchMenuList>
  </div>
);
