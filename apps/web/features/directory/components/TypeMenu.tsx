'use client';

// Which type you are looking at, as one word on the Grid's and the Table's
// bar: the type on show, with its colour square and its count, opening a menu
// of every type that has rows — All first when there is more than one to be
// all of. A type with nothing in it is not offered.
//
// It is a dropdown rather than a column down the left because the list is
// short and the table is wide: a rail spent 212px of every screen saying one
// thing the bar can say in a word. The trigger is a solid box the height and
// frame of the search input beside it, so the bar reads as two controls of
// one family rather than a box and a word floating on the page.

import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import { DROPDOWN_MENU_CLASS } from '@/components/ui/Dropdown';
import { ChevronDownIcon } from '@/features/shared/icons';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import { pluralTypeName } from '@/lib/types/plural';
import { DEFAULT_NODE_TYPES, type NodeTypeConfig } from '@/lib/types';

export interface MenuType {
  /** Lowercased id, the `?type=` value; `all` for every row at once. */
  id: string;
  /** The type's own singular name — the row reads it in the plural. */
  name: string;
  count: number;
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
  nodes: { type: string }[],
  extra: MenuType[] = [],
): MenuType[] {
  const rank = (name: string) => {
    const i = DEFAULT_NODE_TYPES.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
    return i === -1 ? DEFAULT_NODE_TYPES.length : i;
  };
  const typed = [...presentTypes]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => {
      const id = name.toLowerCase();
      return { id, name, count: nodes.filter((n) => n.type.toLowerCase() === id).length };
    });
  const withRows = [...typed, ...extra].filter((t) => t.count > 0);
  return withRows.length > 1 ? [{ id: 'all', name: 'All', count: nodes.length }, ...withRows] : withRows;
}

/** A type's mark: the colour square, in a slot wide enough that All — which
 *  has no colour of its own — leaves its label on the same line as the rest. */
function Mark({ type, nodeTypes }: { type: MenuType; nodeTypes?: NodeTypeConfig[] }) {
  return (
    <span aria-hidden className="flex w-3 shrink-0 justify-center">
      {type.id !== 'all' && (
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: getTypeColor(type.name, nodeTypes) }} />
      )}
    </span>
  );
}

/** A table names a SET: `People`, not `Person` (lib/types/plural.ts). */
function label(type: MenuType, nodeTypes?: NodeTypeConfig[]) {
  return type.id === 'all' ? type.name : pluralTypeName(type.name, nodeTypes);
}

export default function TypeMenu({ types, activeKey, nodeTypes, onChange }: {
  types: MenuType[];
  activeKey: string;
  nodeTypes?: NodeTypeConfig[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const active = types.find((t) => t.id === activeKey) ?? types[0];
  if (!active) return null;

  // One table is not a choice: the bar states it and opens nothing.
  const only = types.length < 2;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={only}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex h-10 shrink-0 items-center gap-2 rounded-lg bg-surface-1 px-3.5 text-sm font-semibold text-text-primary ring-1 transition-[box-shadow,background-color]',
          open ? 'ring-border-default' : 'ring-border-subtle',
          !only && 'hover:bg-surface-2 hover:ring-border-default',
        )}
        aria-haspopup={only ? undefined : 'menu'}
        aria-expanded={only ? undefined : open}
      >
        <Mark type={active} nodeTypes={nodeTypes} />
        <span className="truncate">{label(active, nodeTypes)}</span>
        <span className="text-[11px] font-semibold tabular-nums text-text-muted">{active.count}</span>
        {!only && <ChevronDownIcon className={clsx('ml-1 h-3.5 w-3.5 text-text-muted transition-transform', open && 'rotate-180')} />}
      </button>

      {open && (
        <div className={clsx(DROPDOWN_MENU_CLASS, 'w-[220px]')} role="menu">
          <div className="max-h-[360px] overflow-y-auto overscroll-contain custom-scrollbar">
            {types.map((type) => {
              const picked = type.id === active.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={picked}
                  onClick={() => { onChange(type.id); setOpen(false); }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] transition-colors hover:bg-surface-2"
                >
                  <Mark type={type} nodeTypes={nodeTypes} />
                  <span className={clsx('min-w-0 flex-1 truncate text-left', picked ? 'font-semibold text-text-primary' : 'text-text-secondary')}>
                    {label(type, nodeTypes)}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{type.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
