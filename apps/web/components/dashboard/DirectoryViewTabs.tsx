'use client';

import { UnderlineTabs, type UnderlineTab } from '@/components/ui';

export type DirectoryView = 'grid' | 'graph' | 'tables';

const TABS: UnderlineTab<DirectoryView>[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'graph', label: 'Graph' },
  { id: 'tables', label: 'Tables' },
];

interface DirectoryViewTabsProps {
  active: DirectoryView;
  onChange: (view: DirectoryView) => void;
}

/**
 * Grid / Graph / Tables switcher for the Directory page: the shared
 * UnderlineTabs in a sticky full-bleed bar pinned above the page content. The
 * tabs only swap the page's in-place view — no routing.
 */
export default function DirectoryViewTabs({ active, onChange }: DirectoryViewTabsProps) {
  return (
    <div className="sticky -top-4 -mt-4 z-50 -ml-6 bg-surface-1">
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
