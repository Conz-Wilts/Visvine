'use client';

import type { Space } from '@/lib/types';
import { LABEL_ML, ROW_CLASS, ROW_H, ROW_TEXT } from '@/features/shared/components/layout/railRow';
import { ChevronRightIcon } from '@/features/shared/icons';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';

/**
 * One space in the switcher's lists — the panel of spaces you are in and the
 * column of sub-spaces that opens beside it. A rail row: the avatar centred in
 * the rail's glyph cell, the name beside it at the rail's size, so both columns
 * read as the rail continuing rather than as menus.
 *
 * The whole row is the one control. Pointing at a row that HAS sub-spaces opens
 * their column (`onOpen`), and the chevron only says so — there is no second
 * button to hit, because opening the next column and choosing this space are
 * different gestures (hover and click) rather than different targets.
 *
 * `avatar` is off in the sub-space column: the mark is what tells one SPACE
 * from another in a list of everything you are in, and a column that is one
 * parent's sub-spaces is already that answer. The name keeps the glyph cell's
 * indent either way, so the two columns line up.
 */
export function SpaceListRow({
  space,
  current,
  avatar = true,
  hasChildren = false,
  open = false,
  tabbable,
  onSelect,
  onOpen,
}: {
  space: Space;
  current: boolean;
  avatar?: boolean;
  hasChildren?: boolean;
  open?: boolean;
  tabbable: boolean;
  onSelect: () => void;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onOpen}
      onFocus={onOpen}
      tabIndex={tabbable ? 0 : -1}
      aria-haspopup={hasChildren ? 'menu' : undefined}
      aria-expanded={hasChildren ? open : undefined}
      className={`${ROW_CLASS} min-w-0 text-left ${current || open ? 'bg-surface-3' : ''} ${current ? 'font-semibold' : 'font-normal'}`}
      style={{
        height: ROW_H,
        paddingRight: 16,
        color: current ? 'var(--shell-fg-strong, #111827)' : 'var(--shell-fg-muted, #111827)',
      }}
    >
      {avatar ? (
        <span className="flex shrink-0 items-center justify-center" style={{ width: ROW_H, height: ROW_H }}>
          <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="md" />
        </span>
      ) : (
        <span className="shrink-0" style={{ width: ROW_H }} />
      )}
      <span className={`${ROW_TEXT} min-w-0 flex-1 truncate`} style={{ marginLeft: LABEL_ML }}>{space.name}</span>
      {current && (
        <svg className="h-4 w-4 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      {hasChildren && (
        <span className="ml-1 flex shrink-0 items-center text-text-muted [&>svg]:h-5 [&>svg]:w-5">
          <ChevronRightIcon />
        </span>
      )}
    </button>
  );
}
