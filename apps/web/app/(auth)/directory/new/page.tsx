'use client';

// The note-first create surface: /directory/new renders a blank context note
// you fill in, instead of the sidebar-docked form the "+" used to open. Picking
// a type commits it — a plain Note lands at /directory/note/<path>, an entity
// lands at /directory/<id>?tab=context with a Profile tab now in the bar.
//
// The static `new` segment wins over the sibling /directory/[nodeId] route, the
// same rule /directory/note relies on. No collision risk: node ids are always
// `<type>:<slug>`, never a bare word.

import React, { Suspense, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePaneChrome, type PaneTabItem } from '@/lib/contexts/PaneShellContext';
import type { DraftType } from '@/features/notes/components/DraftContextPanel';

const DraftContextPanel = dynamic(
  () => import('@/features/notes/components/DraftContextPanel').then((m) => m.DraftContextPanel),
  { ssr: false, loading: () => null },
);
const ContextSidebar = dynamic(
  () => import('@/features/notes/components/ContextSidebar').then((m) => m.ContextSidebar),
  { ssr: false, loading: () => null },
);

function useDockInsetStyle(): React.CSSProperties {
  const { dockRequested, contextOpen } = useContextPanel();
  return {
    paddingLeft: dockRequested && contextOpen ? CONTEXT_PANEL_W : undefined,
    transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
  };
}

// Pre-commit the bar matches the standalone note view's — Context and Raw, no
// phantom Profile tab. Until a type is picked this genuinely is a note.
const DRAFT_TABS: PaneTabItem[] = [
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
];

// Every type the draft surface can commit — `?type=` is only a pre-pick, so an
// unknown value just leaves the Type row unset rather than erroring.
const DRAFT_TYPES = new Set<DraftType>([
  'note', 'person', 'group', 'resource',
  'file', 'connector', 'channel', 'space', 'community',
]);

function DraftRoute() {
  const params = useSearchParams();
  const [mode, setMode] = useState<NoteMode>('wysiwyg');
  const dockInsetStyle = useDockInsetStyle();

  const activeTab = mode === 'raw' ? 'raw' : 'context';

  const handleSelect = useCallback((id: string) => {
    setMode(id === 'raw' ? 'raw' : 'wysiwyg');
  }, []);

  // The bar is the shell's; this page registers its tab set and renders its own
  // draft surface, whose panel portals a toolbar into the shell's host.
  usePaneChrome({
    tabs: DRAFT_TABS,
    activeId: activeTab,
    onSelect: handleSelect,
    // Only wysiwyg portals a toolbar into the attached region; Raw is a plain
    // textarea, so the bar stays one row tall there.
    attachedOpen: activeTab === 'context',
    ariaLabel: 'Note sections',
    surface: null,
  });

  // `?folder=` pre-fills the destination when "+" was pressed while standing in
  // a folder; `?type=` pre-picks from the route suggestion.
  const folder = params.get('folder') ?? '';
  const typeParam = params.get('type');
  const initialType = DRAFT_TYPES.has(typeParam as DraftType) ? (typeParam as DraftType) : null;

  return (
    <div className="w-full pb-10">
      <div className="profile-enter" style={dockInsetStyle}>
        <ContextSidebar currentPath="" />
        <DraftContextPanel mode={mode} initialFolder={folder} initialType={initialType} />
      </div>
    </div>
  );
}

export default function NewContextPage() {
  return (
    <Suspense fallback={null}>
      <DraftRoute />
    </Suspense>
  );
}
