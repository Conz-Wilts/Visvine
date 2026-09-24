'use client';

// Which type you are looking at, as one word on the Grid's and the Table's
// bar: the type on show, filled in its colour, with its count, opening a menu
// of every type that has rows, each drawn as its chip — All first when there
// is more than one to be all of. A type with nothing in it is not offered.
//
// A type's aliases hang under it on a spine (TreeChrome's TreeSpine), the
// shape Console → Types draws them in: picking one narrows the view to that
// alias, picking the type clears it. The search reads both, so an alias's
// name finds it under its type.
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
import { Chip, SEARCH_MENU_PANEL, SEARCH_MENU_ROW, SearchMenuEmpty, SearchMenuInput, SearchMenuList, searchMenuRowState, useSearchMenuCursor } from '@visvine/ui';
import { ChevronDownIcon } from '@/features/shared/icons';
import { TREE_ROW_BLEED, TreeSpine, TreeSpineJoin } from '@/features/shared/components/TreeChrome';
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

const PICKED_RING = 'ring-2 ring-line ring-offset-1 ring-offset-surface';

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

  // The search reads the row's own words, so "peo" finds People. A type
  // matched by name keeps every alias; one matched only through an alias keeps
  // just those.
  const q = query.trim().toLowerCase();
  const shown = q
    ? types.flatMap((t) => {
        if (t.id === 'all') return [];
        if (label(t, nodeTypes).toLowerCase().includes(q)) return [t];
        const aliases = (t.aliases ?? []).filter((a) => a.name.toLowerCase().includes(q));
        return aliases.length ? [{ ...t, aliases }] : [];
      })
    : types;
  // Every row in reading order, so the arrow keys walk types and aliases alike.
  const rows = shown.flatMap((t) => [
    { type: t, alias: null as string | null },
    ...(t.aliases ?? []).map((a) => ({ type: t, alias: a.name as string | null })),
  ]);
  const pick = (id: string, alias: string | null) => { onChange(id, alias); close(); };
  const cursor = useSearchMenuCursor({
    count: rows.length,
    resetKey: q,
    onChoose: (i) => { if (rows[i]) pick(rows[i].type.id, rows[i].alias); },
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
              'bg-surface text-fg ring-1',
              open ? 'ring-line' : 'ring-line-subtle',
              !only && 'hover:bg-surface-subtle hover:ring-line',
            ),
        )}
        aria-haspopup={only ? undefined : 'menu'}
        aria-expanded={only ? undefined : open}
      >
        <span className="truncate">{triggerLabel}</span>
        <span className={clsx('text-[11px] leading-4 font-semibold tabular-nums', fill ? 'text-white/80' : 'text-fg-muted')}>{triggerCount}</span>
        {!only && <ChevronDownIcon className={clsx('ml-1 h-3.5 w-3.5 transition-transform', fill ? 'text-white' : 'text-fg-muted', open && 'rotate-180')} />}
      </button>

      {open && (
        <div className={clsx(SEARCH_MENU_PANEL, 'absolute left-0 top-full mt-1.5 w-[300px]')} role="menu">
          <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Search types…" />
          <SearchMenuList active={cursor.active} className="max-h-[440px]">
            {shown.length === 0 && <SearchMenuEmpty />}
            {shown.map((type) => {
              const i = rows.findIndex((r) => r.type.id === type.id && r.alias === null);
              const picked = type.id === active.id && !pickedAlias;
              const aliases = type.aliases ?? [];
              return (
                <div key={type.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={picked}
                    data-menu-row={i}
                    onMouseEnter={() => cursor.setActive(i)}
                    onClick={() => pick(type.id, null)}
                    className={clsx(SEARCH_MENU_ROW, searchMenuRowState(i === cursor.active))}
                  >
                    <span className="min-w-0 flex-1 text-left">
                      {type.id === 'all' ? (
                        // All has no colour to be a chip in: it is the word,
                        // padded to line up with the chip labels under it.
                        <span className={clsx('px-2 text-[12px] font-semibold', picked ? 'text-fg' : 'text-fg-secondary')}>
                          {label(type, nodeTypes)}
                        </span>
                      ) : (
                        <Chip color={getTypeColor(type.name, nodeTypes)} size="md" className={clsx(picked && PICKED_RING)}>
                          <span className="truncate">{label(type, nodeTypes)}</span>
                        </Chip>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] leading-4 tabular-nums text-fg-muted">{type.count}</span>
                  </button>
                  {aliases.length > 0 && (
                    // The spine drops from just under the type's chip: 14px
                    // in puts it a little inside the chip's left edge, and the
                    // stem climbs the row's bottom padding less a hair of air.
                    <div className="pl-3.5">
                      <TreeSpine stem={6}>
                        {aliases.map((alias, k) => {
                          const j = i + 1 + k;
                          const aliasPicked = type.id === active.id && pickedAlias?.name === alias.name;
                          return (
                            <button
                              key={alias.name}
                              type="button"
                              role="menuitemradio"
                              aria-checked={aliasPicked}
                              data-menu-row={j}
                              onMouseEnter={() => cursor.setActive(j)}
                              onClick={() => pick(type.id, alias.name)}
                              className={clsx(
                                TREE_ROW_BLEED,
                                'flex w-[calc(100%+999px)] items-center gap-2.5 py-1.5 pr-4 text-left text-sm transition-colors',
                                searchMenuRowState(j === cursor.active),
                              )}
                            >
                              <TreeSpineJoin kind={k === aliases.length - 1 ? 'last' : 'mid'} />
                              <span className="min-w-0 flex-1 text-left">
                                <Chip color={alias.color} size="sm" className={clsx(aliasPicked && PICKED_RING)}>
                                  <span className="truncate">{alias.name}</span>
                                </Chip>
                              </span>
                              <span className="shrink-0 text-[11px] leading-4 tabular-nums text-fg-muted">{alias.count}</span>
                            </button>
                          );
                        })}
                      </TreeSpine>
                    </div>
                  )}
                </div>
              );
            })}
          </SearchMenuList>
        </div>
      )}
    </div>
  );
}
