'use client';

// The note-first create surface: /directory/new renders a blank context note
// you fill in, instead of the sidebar-docked form the "+" used to open. Picking
// a type commits it — a plain Note lands at /directory/note/<path>, an entity
// lands at /directory/<id>?tab=context with a Profile tab now in the bar.
//
// The static `new` segment wins over the sibling /directory/[nodeId] route, the
// same rule /directory/note relies on. No collision risk: node ids are always
// `<type>:<slug>`, never a bare word.
//
// The shell below is deliberately a near-copy of note/[...path]/page.tsx rather
// than a shared abstraction. Those ~15 lines encode sticky/direct-child/dock
// constraints that each page documents at length, and a wrapper component would
// break the `sticky` scroll range the tab bar depends on.

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import ProfileTabBar, { type ProfileTab, type TabConfig } from '@/components/profile/ProfileTabBar';
import { TabBarSlotProvider } from '@/lib/contexts/TabBarSlotContext';
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

// Pre-commit the bar is byte-identical to the standalone note view's: Context
// and Raw, no phantom Profile tab. The morph reads better as a tab appearing on
// commit than as a dead tab waking up, and until then this genuinely IS a note.
const DRAFT_TABS: TabConfig[] = [
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
];

const DRAFT_TYPES = new Set<DraftType>(['note', 'person', 'group', 'resource']);

function DraftRoute() {
  const params = useSearchParams();
  const [mode, setMode] = useState<NoteMode>('wysiwyg');
  const dockInsetStyle = useDockInsetStyle();
  const { setDockTopInset } = useContextPanel();

  // Two h-12 bars (the tab row and its always-open attached toolbar), so the
  // docked tree starts 96px down, level with where the note begins.
  useEffect(() => {
    setDockTopInset(96);
    return () => setDockTopInset(0);
  }, [setDockTopInset]);

  const activeTab: ProfileTab = mode === 'raw' ? 'raw' : 'context';
  const handleTabChange = useCallback((tab: ProfileTab) => {
    setMode(tab === 'raw' ? 'raw' : 'wysiwyg');
  }, []);

  // `?folder=` pre-fills the destination when "+" was pressed while standing in
  // a folder; `?type=` pre-picks from the route suggestion.
  const folder = params.get('folder') ?? '';
  const typeParam = params.get('type');
  const initialType = DRAFT_TYPES.has(typeParam as DraftType) ? (typeParam as DraftType) : null;

  return (
    <TabBarSlotProvider>
      <div className="profile-enter w-full pb-10">
        <ProfileTabBar
          nodeType="Note"
          tabs={DRAFT_TABS}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          stickyTop="-top-4 -mt-4"
          edgeClass="-ml-[23px] z-[45]"
          attachedOpen
        />
        <div style={dockInsetStyle}>
          <ContextSidebar currentPath="" />
          <DraftContextPanel mode={mode} initialFolder={folder} initialType={initialType} />
        </div>
      </div>
    </TabBarSlotProvider>
  );
}

export default function NewContextPage() {
  return (
    <Suspense fallback={null}>
      <DraftRoute />
    </Suspense>
  );
}
