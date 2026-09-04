'use client';

import type { Space } from '@/lib/types';
import { LABEL_ML, ROW_CLASS, ROW_H, ROW_TEXT } from '@/features/shared/components/layout/railRow';
import { ChevronRightIcon } from '@/features/shared/icons';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { TreeSpineJoin, type TreeGuideKind } from '@/components/ui/TreeChrome';

/** A sub-space row is shorter than its parent's: a line of a list under it. */
const SUBSPACE_ROW_H = 56;
/** The chevron's cell on a parent row: the row's left edge, ahead of the
 *  avatar, so nothing else on the row moves whether or not a row has one.
 *  Wide enough that the glyph, centred in it, stands as far off the avatar as
 *  the name does on the other side. */
const CHEVRON_W = 44;
const AVATAR_PX = 40;
const AVATAR_GAP = 8;
/** The avatar's cell on a list row: the chevron's cell, the avatar, a gap.
 *  Narrower than the rail's glyph cell — the rail shuts under the list, so the
 *  avatar need not sit on the rail's column, and a tight cell keeps the name
 *  close to its mark. */
const LIST_CELL_W = CHEVRON_W + AVATAR_PX + AVATAR_GAP;
/** Where the avatar's centre falls in the row — the switcher's spine hangs
 *  from it. */
export const LIST_AVATAR_CENTER = CHEVRON_W + AVATAR_PX / 2;
export { AVATAR_PX as LIST_AVATAR_PX };

/**
 * One space in the switcher's list. A rail row: the avatar centred in the
 * rail's glyph cell, the name beside it at the rail's size, so the list reads
 * as the rail continuing rather than as a menu.
 *
 * The row is the one control that CHOOSES the space. A space with sub-spaces
 * you are in carries a chevron at the row's far left, its own control:
 * pressing it opens the sub-spaces on a tree under the row (SubspaceRow, hung
 * on a TreeSpine by the switcher) and never picks the space, so opening a
 * branch and choosing its root are two targets rather than two gestures.
 */
export function SpaceListRow({
  space,
  current,
  hasChildren = false,
  open = false,
  tabbable,
  onSelect,
  onToggle,
}: {
  space: Space;
  current: boolean;
  hasChildren?: boolean;
  open?: boolean;
  tabbable: boolean;
  onSelect: () => void;
  onToggle?: () => void;
}) {
  const check = (
    <svg className="h-4 w-4 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        tabIndex={tabbable ? 0 : -1}
        className={`${ROW_CLASS} min-w-0 text-left ${current ? 'bg-surface-3 font-semibold' : 'font-normal'}`}
        style={{
          height: ROW_H,
          paddingRight: 16,
          color: current ? 'var(--shell-fg-strong, #111827)' : 'var(--shell-fg-muted, #111827)',
        }}
      >
        <span className="flex shrink-0 items-center justify-end" style={{ width: LIST_CELL_W, height: ROW_H, paddingRight: AVATAR_GAP }}>
          {/* The same avatar the space wears at the rail's head — 40px on
              10px corners — so the list reads as more of that row. */}
          <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="md" rounded="rounded-[10px]" className="!w-10 !h-10 !text-base" />
        </span>
        <span className={`${ROW_TEXT} min-w-0 flex-1 truncate`} style={{ marginLeft: LABEL_ML }}>{space.name}</span>
        {current && check}
      </button>
      {hasChildren && (
        <button
          type="button"
          aria-label={open ? `Hide sub-spaces of ${space.name}` : `Show sub-spaces of ${space.name}`}
          aria-expanded={open}
          tabIndex={tabbable ? 0 : -1}
          onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          className="absolute top-0 z-20 flex items-center justify-center text-text-muted transition-colors hover:text-text-primary [&>svg]:h-5 [&>svg]:w-5"
          style={{ left: 0, width: CHEVRON_W, height: ROW_H }}
        >
          <span className="flex transition-transform duration-150" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
            <ChevronRightIcon />
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * A sub-space under its parent's row, a line of the tree: the join off the
 * spine, then the name — no mark, because the spine already says whose it is
 * and a space without a picture would only show its initials. A sub-space is
 * its own tenant, so pressing it IS switching space — the parent's row stays
 * what it was.
 */
export function SubspaceRow({
  space,
  current,
  nested,
  tabbable,
  onSelect,
}: {
  space: Space;
  current: boolean;
  nested: TreeGuideKind;
  tabbable: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      tabIndex={tabbable ? 0 : -1}
      className={`${ROW_CLASS} min-w-0 gap-3 pr-4 text-left ${current ? 'bg-surface-3 font-semibold' : 'font-normal'}`}
      style={{
        height: SUBSPACE_ROW_H,
        color: current ? 'var(--shell-fg-strong, #111827)' : 'var(--shell-fg-muted, #111827)',
      }}
    >
      <TreeSpineJoin kind={nested} />
      <span className={`${ROW_TEXT} min-w-0 flex-1 truncate`}>{space.name}</span>
      {current && (
        <svg className="h-4 w-4 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  );
}
