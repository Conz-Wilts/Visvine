'use client';

import { useEffect, useRef, useState } from 'react';
import { rowKey, rowLabel, type CreateRow, type CreateRowList } from '@/lib/create/rows';
import type { SpaceAlias } from '@/lib/types';
import { ITEM_GAP, LABEL_ML, ROW_CLASS, ROW_H, ROW_INSET } from '@/features/shared/components/layout/railRow';
import { ChevronRightIcon } from '@/features/shared/icons';
import { TREE_ROW_BLEED, TreeSpine, TreeSpineJoin } from '@/components/ui/TreeChrome';
import { useSidebar } from '@/features/shared/contexts/SidebarContext';

// The row's leading cell, drawn the way the space switcher's is: the chevron's
// cell at the far left (empty on a kind with no aliases, so every mark lines
// up), then the mark, then one gap before the name. The chevron stands as far
// off the mark as the name does on the other side.
const CHEVRON_W = 40;
const MARK_PX = 16;
const MARK_GAP = 8;
const CELL_W = CHEVRON_W + MARK_PX + MARK_GAP;
const MARK_CENTER = CHEVRON_W + MARK_PX / 2;
// The list's own type scale. A rail row's name sits beside a glyph you
// already know; here the name IS the choice, so it is read a step larger and
// the mark grows with it.
const LIST_TEXT = 'text-[15px] whitespace-nowrap';
// TreeSpine draws its line 14px in (the tree glyph's centre).
const SPINE_DEFAULT_ML = 14;
/** An alias row is shorter than its kind's: a line of a list under it. */
const ALIAS_ROW_H = 44;

/**
 * The Create panel's list: a mark and a name per kind, a hairline before the
 * space's own types, a "New type" row while the search names one. Each row is
 * a rail row — the mark centred in the rail's glyph cell, the name beside it at
 * the rail's size — so the list reads as the rail continuing.
 *
 * It is a tree one level deep: a kind that takes aliases (a Person with
 * Founder and Investor, say) carries a chevron at the row's far left, and
 * pressing it hangs a row per alias under the kind on the tree spine
 * (TreeSpine, the drawing the space switcher and the Context tree use);
 * picking one opens the draft with that alias already on. **New alias** is
 * the first of those rows for someone who may add one, so a kind with none
 * still opens — it is offered exactly where the aliases are read, and leads to
 * the console section that owns them, because an alias is space vocabulary
 * rather than a thing you are making. Arrow keys move over the kinds, Enter
 * picks — the search box above owns the keyboard, so this takes the active
 * index from it.
 */
export default function TypeList({
  list,
  active,
  aliasesOf,
  canAddAlias,
  onHover,
  onPick,
  onNewAlias,
}: {
  list: CreateRowList;
  /** Index of the keyboard-highlighted row. */
  active: number;
  /** The space's aliases for a kind — empty for one that takes none. */
  aliasesOf: (row: CreateRow) => SpaceAlias[];
  /** Whether this person may add one to the kind (the space's admins may). */
  canAddAlias: (row: CreateRow) => boolean;
  onHover: (index: number) => void;
  onPick: (row: CreateRow, alias?: SpaceAlias) => void;
  /** Leads to where aliases are minted; the row it was pressed on is passed. */
  onNewAlias: (row: CreateRow) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const { reduced } = useSidebar();
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
        const canAdd = canAddAlias(row);
        const branches = aliases.length + (canAdd ? 1 : 0);
        const expanded = branches > 0 && open.has(key);
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
                style={{ height: ROW_H, paddingRight: 16, color: 'var(--shell-fg-muted, #111827)' }}
              >
                <span className="flex shrink-0 items-center justify-end" style={{ width: CELL_W, height: ROW_H, paddingRight: MARK_GAP }}>
                  <Mark row={row} size={MARK_PX} />
                </span>
                <span className={`${LIST_TEXT} min-w-0 flex-1 truncate`} style={{ marginLeft: LABEL_ML }}>
                  {row.kind === 'new-type' ? (
                    <>
                      New type{row.name && <span className="text-text-secondary"> “{row.name}”</span>}
                    </>
                  ) : (
                    rowLabel(row)
                  )}
                </span>
              </button>
              {/* The chevron is its own control at the row's far left, laid
                  over the leading cell, so opening the aliases never picks the
                  kind. */}
              {branches > 0 && (
                <button
                  type="button"
                  aria-label={expanded ? `Hide ${rowLabel(row)} aliases` : `Show ${rowLabel(row)} aliases`}
                  aria-expanded={expanded}
                  onClick={(e) => { e.stopPropagation(); toggle(key); }}
                  className="absolute left-0 top-0 z-20 flex items-center justify-center text-text-muted transition-colors hover:text-text-primary [&>svg]:h-4 [&>svg]:w-4"
                  style={{ width: CHEVRON_W, height: ROW_H }}
                >
                  <span className="flex transition-transform duration-150" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
                    <ChevronRightIcon />
                  </span>
                </button>
              )}
            </div>
            {expanded && (
              // The spine sits under the centre of the kind's mark, not
              // TreeSpine's default 14px, and its stem climbs from the branch's
              // top to the mark's bottom edge.
              <div style={{ marginLeft: MARK_CENTER - SPINE_DEFAULT_ML }}>
                <TreeSpine animate={!reduced} stem={ROW_H / 2 - MARK_PX / 2}>
                  {canAdd && (
                    <AliasRow
                      // "New alias" leads the list for the same reason "New
                      // type" leads the panel's: it is the row you are looking
                      // for when the one you want isn't there.
                      last={aliases.length === 0}
                      swatch={<span aria-hidden className="shrink-0 rounded-[3px] border border-dashed border-text-muted" style={{ width: 13, height: 13 }} />}
                      label="New alias"
                      onClick={() => onNewAlias(row)}
                    />
                  )}
                  {aliases.map((alias, j) => (
                    <AliasRow
                      key={alias.id ?? alias.name}
                      last={j === aliases.length - 1}
                      swatch={<span aria-hidden className="shrink-0 rounded-[3px]" style={{ width: 13, height: 13, background: alias.color }} />}
                      label={alias.name}
                      onClick={() => onPick(row, alias)}
                    />
                  ))}
                </TreeSpine>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One row on a kind's spine: an alias it holds, or the row that makes one. */
function AliasRow({ last, swatch, label, onClick }: {
  last: boolean;
  swatch: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The band runs the panel's full width (TREE_ROW_BLEED); z-0 keeps it
      // under the spine's line.
      className={`${ROW_CLASS} !z-0 !w-[calc(100%+999px)] ${TREE_ROW_BLEED} min-w-0 gap-3 pr-4 text-left`}
      style={{ height: ALIAS_ROW_H, color: 'var(--shell-fg-muted, #111827)' }}
    >
      <TreeSpineJoin kind={last ? 'last' : 'mid'} />
      {swatch}
      <span className={`${LIST_TEXT} min-w-0 flex-1 truncate`}>{label}</span>
    </button>
  );
}

/** The kind's colour as a square; a dashed one for a type that does not exist yet. */
function Mark({ row, size = 10 }: { row: CreateRow; size?: number }) {
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
