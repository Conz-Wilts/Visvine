'use client';

import { useEffect, useRef } from 'react';
import { UnderlineTabs, type UnderlineTab } from '@/components/ui';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';

export type DirectoryView = 'grid' | 'context';

const TABS: UnderlineTab<DirectoryView>[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'context', label: 'Context' },
];

interface DirectoryViewTabsProps {
  active: DirectoryView;
  onChange: (view: DirectoryView) => void;
}

/**
 * Grid / Context switcher for the Directory page: the shared
 * UnderlineTabs in a sticky full-bleed bar pinned above the page content. The
 * tabs only swap the page's in-place view — no routing.
 *
 * z-[45] sits ABOVE the sidebar's docked notes tree (z-40, context view) but
 * BELOW the navbar (z-50) — the bar bleeds flush into the top-left corner, so a
 * higher z would paint over the navbar↔rail concave seam curve the navbar draws
 * there. Letting the navbar win keeps that curve visible.
 *
 * The left bleed stops 1px short of the rail edge (-ml-[23px], not -m6/-24px):
 * the sidebar card's right border sits in that last pixel, so bleeding fully
 * over it would hide the vertical seam behind the bar's opaque bg — leaving a
 * gap between the fillet curve above and the rail border below.
 */
export default function DirectoryViewTabs({ active, onChange }: DirectoryViewTabsProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const { setDockTopInset } = useContextPanel();

  // Publish this bar's height so anything hosted in the sidebar card's panel
  // column (the Create panel, a docked tree) starts BELOW it instead of behind
  // it — the bar bleeds over the card top and outranks it at z-[45].
  useEffect(() => {
    setDockTopInset(barRef.current?.offsetHeight ?? 0);
    return () => setDockTopInset(0);
  }, [setDockTopInset]);

  return (
    <div ref={barRef} className="sticky -top-4 -mt-4 z-[45] -ml-[23px] bg-surface-1">
      <UnderlineTabs
        tabs={TABS}
        value={active}
        onChange={onChange}
        ariaLabel="Directory views"
        idPrefix="directory"
        className="w-full overflow-x-auto px-1"
      />
    </div>
  );
}
