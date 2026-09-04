'use client';

import { useEffect, useMemo, useState } from 'react';
import { DOCK_EASE, DOCK_MS, useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { ITEM_GAP, LABEL_ML, ROW_H, ROW_INSET } from '@/features/shared/components/layout/railRow';
import { SpaceListRow } from '@/features/spaces/components/SpaceListRow';
import { spaceBranches } from '@/lib/spaces/subspaces';

/**
 * The sub-spaces of the space the switcher's pointer is on, as a column beside
 * the switcher's own — the same rail rows, the same width, slid out from under
 * it (SidebarContext#switcherParentId). Pointing at a parent opens it; pointing
 * at any other row of the switcher shuts it, and leaving the card shuts the
 * pair. Nothing folds and nothing indents: each level is a column, so a
 * sub-space's name has the whole rail's width the way its parent's does.
 *
 * A sub-space is its own tenant, so choosing one here IS switching space — the
 * parent's row stays exactly what it was. Spaces nest one level
 * (docs/sub-spaces.md), so this is the last column: nothing here opens another.
 */
export default function SubspacePanel() {
  const { switcherOpen, setSwitcherOpen, switcherParentId, setSwitcherParentId, reduced } = useSidebar();
  const { currentSpace, joinedSpaces, setCurrentSpace } = useSpace();
  const isOpen = switcherOpen && switcherParentId !== null;

  // The branch stays on screen for the slide out: dropping it the moment the
  // pointer leaves the parent's row would empty the column before it has
  // travelled back under the switcher.
  const [shownId, setShownId] = useState<string | null>(null);
  useEffect(() => {
    if (switcherParentId) return setShownId(switcherParentId);
    const t = setTimeout(() => setShownId(null), reduced ? 0 : DOCK_MS);
    return () => clearTimeout(t);
  }, [switcherParentId, reduced]);

  const branch = useMemo(() => {
    if (!shownId) return null;
    const sorted = [...joinedSpaces].sort((a, b) => a.name.localeCompare(b.name));
    return spaceBranches(sorted).find((b) => b.space.id === shownId) ?? null;
  }, [joinedSpaces, shownId]);

  const select = (spaceId: string) => {
    setCurrentSpace(spaceId);
    setSwitcherOpen(false);
  };

  return (
    <aside
      role="menu"
      aria-label={branch ? `Sub-spaces of ${branch.space.name}` : 'Sub-spaces'}
      aria-hidden={!isOpen}
      className={`absolute inset-0 z-10 flex flex-col overflow-hidden border-r border-border-subtle bg-surface-1 ${isOpen ? '' : 'pointer-events-none'}`}
      // Inline transform, matching the switcher's: Tailwind v4's translate
      // utilities compile to the `translate` property, which `transition:
      // transform` never animates.
      style={{
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: reduced ? 'none' : `transform ${DOCK_MS}ms ${DOCK_EASE}`,
      }}
      // The pointer crossing out of the switcher and into this column must not
      // shut it — the row it came from is no longer under the pointer.
      onMouseEnter={() => { if (shownId) setSwitcherParentId(shownId); }}
    >
      {/* Head, level with the switcher's search and the space at the rail's
          head: whose sub-spaces these are. It is a label, not a row — the
          parent is one column to the left, already a row you can press. */}
      <div className="flex flex-shrink-0 items-center px-3" style={{ height: ROW_H }}>
        <span className="min-w-0 truncate text-[13px] font-medium uppercase tracking-wide text-text-muted" style={{ marginLeft: LABEL_ML }}>
          {branch ? `In ${branch.space.name}` : ''}
        </span>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pb-3" style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
        <div className="flex flex-col" style={{ gap: ITEM_GAP }}>
          {(branch?.children ?? []).map((space) => (
            <SpaceListRow
              key={space.id}
              space={space}
              current={currentSpace?.id === space.id}
              avatar={false}
              tabbable={isOpen}
              onSelect={() => select(space.id)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
