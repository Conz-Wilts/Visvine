'use client';

// Which table you are in, as one row of tabs over the bar and the table:
// All, then every type
// with rows, each under its colour square with its count beside it. The
// current one sits on a rounded square, the shape every label in the app
// wears; the rest are plain text that fill on hover.
// It replaces a menu because the list is short — a space records a handful
// of kinds, not forty — and a row you can see beats a row you have to open.

import { clsx } from 'clsx';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import { pluralTypeName } from '@/lib/types/plural';
import type { NodeTypeConfig } from '@/lib/types';

export interface StripType {
  /** Lowercased id, the `?type=` value; `all` for every row at once. */
  id: string;
  /** The type's own singular name — the tab reads it in the plural. */
  name: string;
  count: number;
}

export default function TypeStrip({ types, activeKey, nodeTypes, onChange }: {
  types: StripType[];
  activeKey: string;
  nodeTypes?: NodeTypeConfig[];
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Tables" className="flex flex-wrap items-center gap-1">
      {types.map((type) => {
        const active = type.id === activeKey;
        const all = type.id === 'all';
        return (
          <button
            key={type.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(type.id)}
            className={clsx(
              'inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors',
              active ? 'bg-surface-2 text-text-primary ring-1 ring-border-subtle' : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
            )}
          >
            {!all && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: getTypeColor(type.name, nodeTypes) }} />}
            {/* A tab names a TABLE, which is a set: `People`, not `Person`
                (lib/types/plural.ts). The id stays the singular type. */}
            <span>{all ? type.name : pluralTypeName(type.name, nodeTypes)}</span>
            <span className={clsx('shrink-0 text-[11px] tabular-nums', active ? 'text-text-secondary' : 'text-text-muted')}>
              {type.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
