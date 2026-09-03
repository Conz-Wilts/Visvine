'use client';

import { useEffect, useRef, useState } from 'react';
import { rowKey, rowLabel, type CreateRow, type CreateRowList } from '@/lib/create/rows';
import { ITEM_GAP, LABEL_ML, ROW_CLASS, ROW_H, ROW_INSET, ROW_TEXT } from '@/features/shared/components/layout/railRow';

/**
 * The Create panel's list: a dot and a name per kind, a hairline before the
 * space's own types, a "New type" row while the search names one. Each row is
 * a rail row — the dot centred in the rail's glyph cell, the name beside it at
 * the rail's size — so the list reads as the rail continuing. Arrow keys
 * move, Enter picks — the search box above owns the keyboard, so this takes
 * the active index from it.
 */
export default function TypeList({
  list,
  active,
  onHover,
  onPick,
}: {
  list: CreateRowList;
  /** Index of the keyboard-highlighted row. */
  active: number;
  onHover: (index: number) => void;
  onPick: (row: CreateRow) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
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

  return (
    <div role="listbox" aria-label="What to create" className="flex flex-col" style={{ gap: ITEM_GAP, paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
      {list.rows.map((row, i) => (
        <div key={rowKey(row)}>
          {list.dividerAt === i && <div className="border-t" style={{ marginTop: ITEM_GAP, marginBottom: ITEM_GAP, borderTopColor: 'var(--shell-border, #e5e7eb)' }} />}
          <button
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseMove={() => onHover(i)}
            onClick={() => onPick(row)}
            className={`${ROW_CLASS} pr-4 text-left ${i === active ? 'bg-surface-3' : ''}`}
            style={{ height: ROW_H, color: 'var(--shell-fg-muted, #111827)' }}
          >
            <span className="flex shrink-0 items-center justify-center" style={{ width: ROW_H, height: ROW_H }}>
              <Dot row={row} size={14} />
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
        </div>
      ))}
    </div>
  );
}

/** The kind's colour as a dot; a dashed ring for a type that does not exist yet. */
export function Dot({ row, size = 10 }: { row: CreateRow; size?: number }) {
  if (row.kind === 'new-type') {
    return (
      <span
        aria-hidden
        className="shrink-0 rounded-full border border-dashed border-text-muted"
        style={{ width: size, height: size }}
      />
    );
  }
  return <span aria-hidden className="shrink-0 rounded-full" style={{ width: size, height: size, background: row.color }} />;
}
