'use client';

import { useEffect, useRef, useState } from 'react';
import { rowKey, rowLabel, type CreateRow, type CreateRowList } from '@/lib/create/rows';
import type { SpaceAlias } from '@/lib/types';
import { ITEM_GAP, LABEL_ML, ROW_CLASS, ROW_H, ROW_INSET, ROW_TEXT } from '@/features/shared/components/layout/railRow';
import { ChevronRightIcon } from '@/features/shared/icons';

/**
 * The Create panel's list: a mark and a name per kind, a hairline before the
 * space's own types, a "New type" row while the search names one. Each row is
 * a rail row — the mark centred in the rail's glyph cell, the name beside it at
 * the rail's size — so the list reads as the rail continuing.
 *
 * It is a tree one level deep: a kind the space holds aliases for (a Person
 * with Founder and Investor, say) opens on its chevron to a row per alias,
 * stepped in under it, and picking one starts the form with that alias
 * already on. Arrow keys move over the kinds, Enter picks — the search box
 * above owns the keyboard, so this takes the active index from it.
 */
export default function TypeList({
  list,
  active,
  aliasesOf,
  onHover,
  onPick,
}: {
  list: CreateRowList;
  /** Index of the keyboard-highlighted row. */
  active: number;
  /** The space's aliases for a kind — empty for one that takes none. */
  aliasesOf: (row: CreateRow) => SpaceAlias[];
  onHover: (index: number) => void;
  onPick: (row: CreateRow, alias?: SpaceAlias) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Keep the highlighted row in view while arrowing through a long list.
  const [lastActive, setLastActive] = useState(active);
  useEffect(() => {
    if (active !== lastActive) {
      refs.current[active]?.scrollIntoView({ block: 'nearest' });
      setLastActive(active);
    }
  }, [active, lastActive]);

  if (list.rows.length === 0) {
    return <div className="p-4 text-center text-sm text-text-muted">Nothing to make</div>;
  }

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div role="listbox" aria-label="What to create" className="flex flex-col" style={{ gap: ITEM_GAP, paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
      {list.rows.map((row, i) => {
        const key = rowKey(row);
        const aliases = aliasesOf(row);
        const expanded = aliases.length > 0 && open.has(key);
        return (
          <div key={key}>
            {list.dividerAt === i && <div className="border-t" style={{ marginTop: ITEM_GAP, marginBottom: ITEM_GAP, borderTopColor: 'var(--shell-border, #e5e7eb)' }} />}
            <div className="relative">
              <button
                ref={(el) => { refs.current[i] = el; }}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseMove={() => onHover(i)}
                onClick={() => onPick(row)}
                className={`${ROW_CLASS} text-left ${i === active ? 'bg-surface-3' : ''}`}
                style={{ height: ROW_H, paddingRight: aliases.length > 0 ? ROW_H : 16, color: 'var(--shell-fg-muted, #111827)' }}
              >
                <span className="flex shrink-0 items-center justify-center" style={{ width: ROW_H, height: ROW_H }}>
                  <Mark row={row} size={14} />
                </span>
                <span className={`${ROW_TEXT} min-w-0 flex-1 truncate`} style={{ marginLeft: LABEL_ML }}>
                  {row.kind === 'new-type' ? (
                    <>
                      New type <span className="text-text-secondary">“{row.name}”</span>
                    </>
                  ) : (
                    rowLabel(row)
                  )}
                </span>
              </button>
              {/* The chevron is its own control on the row's trailing cell, so
                  opening the aliases never picks the kind. */}
              {aliases.length > 0 && (
                <button
                  type="button"
                  aria-label={expanded ? `Hide ${rowLabel(row)} aliases` : `Show ${rowLabel(row)} aliases`}
                  aria-expanded={expanded}
                  onClick={(e) => { e.stopPropagation(); toggle(key); }}
                  className="absolute right-0 top-0 z-20 flex items-center justify-center text-text-muted transition-colors hover:text-text-primary [&>svg]:h-5 [&>svg]:w-5"
                  style={{ width: ROW_H, height: ROW_H }}
                >
                  <span className="transition-transform duration-150" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
                    <ChevronRightIcon />
                  </span>
                </button>
              )}
            </div>
            {expanded &&
              aliases.map((alias) => (
                <button
                  key={alias.id ?? alias.name}
                  type="button"
                  onClick={() => onPick(row, alias)}
                  className={`${ROW_CLASS} pr-4 text-left`}
                  style={{ height: ROW_H, paddingLeft: 24, color: 'var(--shell-fg-muted, #111827)' }}
                >
                  <span className="flex shrink-0 items-center justify-center" style={{ width: ROW_H, height: ROW_H }}>
                    <span aria-hidden className="shrink-0 rounded-[3px]" style={{ width: 12, height: 12, background: alias.color }} />
                  </span>
                  <span className={`${ROW_TEXT} min-w-0 flex-1 truncate`} style={{ marginLeft: LABEL_ML }}>{alias.name}</span>
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** The kind's colour as a square; a dashed one for a type that does not exist yet. */
export function Mark({ row, size = 10 }: { row: CreateRow; size?: number }) {
  if (row.kind === 'new-type') {
    return (
      <span
        aria-hidden
        className="shrink-0 rounded-[3px] border border-dashed border-text-muted"
        style={{ width: size, height: size }}
      />
    );
  }
  return <span aria-hidden className="shrink-0 rounded-[3px]" style={{ width: size, height: size, background: row.color }} />;
}
