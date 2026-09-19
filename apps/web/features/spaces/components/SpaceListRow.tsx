'use client';

import type { Space } from '@/lib/types';
import type { LockedSubspace } from '@/lib/spaces/subspaceAccess';
import { END_ROW_H, LABEL_ML, ROW_CLASS, ROW_TEXT } from '@/features/shared/components/layout/railRow';
import { ChevronRightIcon, LockIcon, PlusIcon } from '@/features/shared/icons';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { TREE_ROW_BLEED, TreeSpineJoin, type TreeGuideKind } from '@/components/ui/TreeChrome';

/** A sub-space row is shorter than its parent's: a line of a list under it. */
const SUBSPACE_ROW_H = 44;
/** The chevron's cell on a parent row: the row's left edge, ahead of the
 *  avatar, so nothing else on the row moves whether or not a row has one.
 *  Wide enough that the glyph, centred in it, stands as far off the avatar as
 *  the name does on the other side. */
const CHEVRON_W = 40;
const AVATAR_PX = 36;
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
          height: END_ROW_H,
          paddingRight: 16,
          color: current ? 'var(--shell-fg-strong, #111827)' : 'var(--shell-fg-muted, #111827)',
        }}
      >
        <span className="flex shrink-0 items-center justify-end" style={{ width: LIST_CELL_W, height: END_ROW_H, paddingRight: AVATAR_GAP }}>
          {/* The same avatar the space wears at the rail's head — 36px on
              8px corners — so the list reads as more of that row. */}
          <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="md" rounded="rounded-[8px]" className="!w-9 !h-9 !text-sm" />
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
          className="absolute top-0 z-20 flex items-center justify-center text-text-muted transition-colors hover:text-text-primary [&>svg]:h-4 [&>svg]:w-4"
          style={{ left: 0, width: CHEVRON_W, height: END_ROW_H }}
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
      // The band runs the panel's full width, from under the spine's indent
      // out to the edge (TREE_ROW_BLEED); z-0 keeps it under the spine's line.
      className={`${ROW_CLASS} !z-0 !w-[calc(100%+999px)] ${TREE_ROW_BLEED} min-w-0 gap-3 pr-4 text-left ${current ? 'bg-surface-3 font-semibold' : 'font-normal'}`}
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

/**
 * A private sub-space of a space you are in, that you are not in: the name,
 * and a lock where the check would be.
 *
 * It is drawn at all because a private sub-space is closed, not secret — a
 * member who cannot see the room has no way to ask for it, and the ask is the
 * point. Pressing it does not switch space (there is nothing to switch to);
 * it opens the door: who is in there, and a button that puts the request in
 * front of that sub-space's admins — or, for a room open to the parent's
 * members (house door `open`), the "Join" that walks straight in.
 */
export function LockedSubspaceRow({
  space,
  nested,
  tabbable,
  onSelect,
}: {
  space: LockedSubspace;
  nested: TreeGuideKind;
  tabbable: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      tabIndex={tabbable ? 0 : -1}
      aria-label={`${space.name} — private${space.houseDoor === 'open' ? ', open to members here' : space.requested ? ', access requested' : ', request access'}`}
      className={`${ROW_CLASS} !z-0 !w-[calc(100%+999px)] ${TREE_ROW_BLEED} min-w-0 gap-3 pr-4 text-left font-normal`}
      style={{ height: SUBSPACE_ROW_H, color: 'var(--shell-fg-muted, #111827)' }}
    >
      <TreeSpineJoin kind={nested} />
      <span className={`${ROW_TEXT} min-w-0 flex-1 truncate opacity-70`}>{space.name}</span>
      {space.houseDoor === 'open' ? (
        <span className="shrink-0 text-[11px] text-text-muted">Join</span>
      ) : (
        space.requested && <span className="shrink-0 text-[11px] text-text-muted">Asked</span>
      )}
      <LockIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
    </button>
  );
}

/**
 * The list's first row: starting a space of your own. It belongs to the list
 * rather than to the band above it, because a space you are about to make is
 * one more of the spaces the list is already offering — and it LEADS the list
 * for the reason "New type" leads the Create panel: it is the row you are
 * looking for when none of the ones below is the one you want. Drawn as a
 * list row with a plus on the avatar's square instead of a mark.
 */
export function NewSpaceRow({ tabbable, onClick }: { tabbable: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={tabbable ? 0 : -1}
      className={`${ROW_CLASS} min-w-0 text-left font-normal`}
      style={{ height: END_ROW_H, paddingRight: 16, color: 'var(--shell-fg-muted, #111827)' }}
    >
      <span className="flex shrink-0 items-center justify-end" style={{ width: LIST_CELL_W, height: END_ROW_H, paddingRight: AVATAR_GAP }}>
        <span
          className="flex items-center justify-center rounded-[8px] border border-dashed border-border-default text-text-muted [&>svg]:h-4 [&>svg]:w-4"
          style={{ width: AVATAR_PX, height: AVATAR_PX }}
        >
          <PlusIcon />
        </span>
      </span>
      <span className={`${ROW_TEXT} min-w-0 flex-1 truncate`} style={{ marginLeft: LABEL_ML }}>New space</span>
    </button>
  );
}

/**
 * The row that makes a sub-space, first on a space's own branch — the shape
 * "New alias" has at the head of a kind's aliases in the Create panel: making
 * one is offered exactly where they are read, so a space with no sub-spaces
 * still opens for the admin who may add the first.
 */
export function NewSubspaceRow({ parentName, nested, tabbable, onClick }: {
  parentName: string;
  nested: TreeGuideKind;
  tabbable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={tabbable ? 0 : -1}
      aria-label={`New sub-space of ${parentName}`}
      className={`${ROW_CLASS} !z-0 !w-[calc(100%+999px)] ${TREE_ROW_BLEED} min-w-0 gap-3 pr-4 text-left font-normal`}
      style={{ height: SUBSPACE_ROW_H, color: 'var(--shell-fg-muted, #111827)' }}
    >
      <TreeSpineJoin kind={nested} />
      <span aria-hidden className="flex shrink-0 items-center justify-center rounded-[5px] border border-dashed border-text-muted text-text-muted [&>svg]:h-3 [&>svg]:w-3" style={{ width: 20, height: 20 }}>
        <PlusIcon />
      </span>
      <span className={`${ROW_TEXT} min-w-0 flex-1 truncate`}>New sub-space</span>
    </button>
  );
}
