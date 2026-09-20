'use client';

// Which type you are looking at, as one word on the Grid's and the Table's
// bar: the type on show, filled in its colour, with its count, opening a menu
// of every type that has rows, each drawn as its chip — All first when there
// is more than one to be all of. A type with nothing in it is not offered.
//
// The menu lists types only — aliases are not offered here. An alias already
// narrowing the view (from the URL) still shows on the trigger, and picking
// any type clears it.
//
// It is a dropdown rather than a column down the left because the list is
// short and the table is wide: a rail spent 212px of every screen saying one
// thing the bar can say in a word. The trigger stretches to the height of
// the search input beside it, so the bar reads as two controls of
// one family rather than a box and a word floating on the page. The menu is
// the shared search menu (components/ui/SearchMenu), as the Tags beside it.

import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import Chip from '@/components/ui/Chip';
import {
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  SearchMenuEmpty,
  SearchMenuInput,
  SearchMenuList,
  searchMenuRowState,
  useSearchMenuCursor,
} from '@/components/ui/SearchMenu';
import { ChevronDownIcon } from '@/features/shared/icons';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import { pluralTypeName } from '@/lib/types/plural';
import { DEFAULT_NODE_TYPES, aliasesForType, type NodeTypeConfig, type SpaceAlias } from '@/lib/types';

interface MenuAlias {
  name: string;
  color: string;
  count: number;
}

export interface MenuType {
  /** Lowercased id, the `?type=` value; `all` for every row at once. */
  id: string;
  /** The type's own singular name — the row reads it in the plural. */
  name: string;
  count: number;
  /** The type's aliases that some row holds, in the space's order. */
  aliases?: MenuAlias[];
  /** Listed with no rows too — a table whose empty state is where one is asked for. */
  always?: boolean;
}

/** The menu's entries: every type with rows, built-ins first in their
 *  canonical order, then the space's own — so Person is always the first stop
 *  and a type the space invented sits after the ones everyone has. `extra`
 *  rows (Agents, which the directory feed does not carry) follow them. An
 *  entry is keyed by the type's own name, not its canonical base: Company
 *  folds onto Space for the entity machinery, but a space that records both
 *  wants two. */
export function menuTypes(
  presentTypes: string[],
  nodes: { type: string; alias?: string | null }[],
  extra: MenuType[] = [],
  spaceAliases?: SpaceAlias[],
): MenuType[] {
  const rank = (name: string) => {
    const i = DEFAULT_NODE_TYPES.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
    return i === -1 ? DEFAULT_NODE_TYPES.length : i;
  };
  const typed: MenuType[] = [...presentTypes]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => {
      const id = name.toLowerCase();
      const rows = nodes.filter((n) => n.type.toLowerCase() === id);
      const aliases = aliasesForType(spaceAliases, name)
        .map((a) => ({ name: a.name, color: a.color, count: rows.filter((n) => n.alias === a.name).length }))
        .filter((a) => a.count > 0);
      return { id, name, count: rows.length, aliases };
    });
  const withRows = [...typed, ...extra].filter((t) => t.count > 0 || t.always);
  return withRows.length > 1 ? [{ id: 'all', name: 'All', count: nodes.length }, ...withRows] : withRows;
}

/** A table names a SET: `People`, not `Person` (lib/types/plural.ts). */
function label(type: MenuType, nodeTypes?: NodeTypeConfig[]) {
  return type.id === 'all' ? type.name : pluralTypeName(type.name, nodeTypes);
}

const PICKED_RING = 'ring-2 ring-border-default ring-offset-1 ring-offset-surface-1';

export default function TypeMenu({ types, activeKey, activeAlias, nodeTypes, onChange }: {
  types: MenuType[];
  activeKey: string;
  /** The alias narrowing the active type, if one is picked. */
  activeAlias?: string | null;
  nodeTypes?: NodeTypeConfig[];
  /** `alias` is null when the type itself was picked. */
  onChange: (id: string, alias: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setQuery(''); };
  useClickOutside(ref, close);

  // The search reads the row's own words, so "peo" finds People.
  const q = query.trim().toLowerCase();
  const shown = q ? types.filter((t) => t.id !== 'all' && label(t, nodeTypes).toLowerCase().includes(q)) : types;
  // Picking a type clears any alias narrowing it.
  const pick = (id: string) => { onChange(id, null); close(); };
  const cursor = useSearchMenuCursor({
    count: shown.length,
    resetKey: q,
    onChoose: (i) => { if (shown[i]) pick(shown[i].id); },
    onClose: close,
  });

  const active = types.find((t) => t.id === activeKey) ?? types[0];
  if (!active) return null;
  const pickedAlias = activeAlias ? active.aliases?.find((a) => a.name === activeAlias) : undefined;

  // One table is not a choice: the bar states it and
  // opens nothing.
  const only = types.length < 2;

  // The trigger wears what it shows: All is the plain surface box, a type
  // fills the whole button with its own colour — the chip, grown to the
  // control — and an alias with its own, with white text and chevron over it.
  const fill = pickedAlias?.color ?? (active.id === 'all' ? undefined : getTypeColor(active.name, nodeTypes));
  const triggerLabel = pickedAlias?.name ?? (active.id === 'all' ? 'All Types' : label(active, nodeTypes));
  const triggerCount = pickedAlias?.count ?? active.count;

  return (
    <div ref={ref} className="relative flex self-stretch">
      <button
        type="button"
        disabled={only}
        onClick={() => (open ? close() : setOpen(true))}
        style={fill ? { background: fill } : undefined}
        className={clsx(
          'flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-[box-shadow,background-color,filter]',
          fill
            ? clsx('text-white', open && 'brightness-95', !only && 'hover:brightness-95')
            : clsx(
              'bg-surface-1 text-text-primary ring-1',
              open ? 'ring-border-default' : 'ring-border-subtle',
              !only && 'hover:bg-surface-2 hover:ring-border-default',
            ),
        )}
        aria-haspopup={only ? undefined : 'menu'}
        aria-expanded={only ? undefined : open}
      >
        <span className="truncate">{triggerLabel}</span>
        <span className={clsx('text-[11px] leading-4 font-semibold tabular-nums', fill ? 'text-white/80' : 'text-text-muted')}>{triggerCount}</span>
        {!only && <ChevronDownIcon className={clsx('ml-1 h-3.5 w-3.5 transition-transform', fill ? 'text-white' : 'text-text-muted', open && 'rotate-180')} />}
      </button>

      {open && (
        <div className={clsx(SEARCH_MENU_PANEL, 'absolute left-0 top-full mt-1.5 w-[300px]')} role="menu">
          <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Search types…" />
          <SearchMenuList active={cursor.active} className="max-h-[440px]">
            {shown.length === 0 && <SearchMenuEmpty />}
            {shown.map((type, i) => {
              const picked = type.id === active.id && !pickedAlias;
              return (
                <button
                  key={type.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={picked}
                  data-menu-row={i}
                  onMouseEnter={() => cursor.setActive(i)}
                  onClick={() => pick(type.id)}
                  className={clsx(SEARCH_MENU_ROW, searchMenuRowState(i === cursor.active))}
                >
                  <span className="min-w-0 flex-1 text-left">
                    {type.id === 'all' ? (
                      // All has no colour to be a chip in: it is the word,
                      // padded to line up with the chip labels under it.
                      <span className={clsx('px-2 text-[12px] font-semibold', picked ? 'text-text-primary' : 'text-text-secondary')}>
                        {label(type, nodeTypes)}
                      </span>
                    ) : (
                      <Chip color={getTypeColor(type.name, nodeTypes)} size="md" className={clsx(picked && PICKED_RING)}>
                        <span className="truncate">{label(type, nodeTypes)}</span>
                      </Chip>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] leading-4 tabular-nums text-text-muted">{type.count}</span>
                </button>
              );
            })}
          </SearchMenuList>
        </div>
      )}
    </div>
  );
}
