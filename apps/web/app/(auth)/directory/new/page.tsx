'use client';

// The create surface: /directory/new renders a blank context note you fill in
// — a note, a folder, an agent's brief, a person, a channel, an upload —
// reached from the Create panel with the shape already chosen
// (lib/create/rows.ts) or bare from the tree's "+". This route only reads the
// query; DraftContextPanel is the surface.
//
// The static `new` segment wins over the sibling /directory/[nodeId] route, the
// same rule /directory/note relies on. No collision risk: node ids are always
// `<type>:<slug>`, never a bare word.

import React, { Suspense, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import { draftHasProse, isDraftKind, type DraftKind } from '@/lib/create/rows';

const DraftContextPanel = dynamic(
  () => import('@/features/notes/components/DraftContextPanel').then((m) => m.DraftContextPanel),
  { ssr: false, loading: () => null },
);
// No docked context tree here on purpose. The draft has nothing to be beside:
// there is no note to locate in the tree yet, and where this one lands is asked
// for at the moment of creating (the destination popup), not browsed for while
// typing. The surface gets the full card width.

// Pre-commit the bar matches the standalone note view's — Context and Raw, no
// phantom Profile tab. Until a type is picked this genuinely is a note.
const DRAFT_TABS: PaneTabItem[] = [
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
];

function DraftRoute() {
  const params = useSearchParams();
  const [mode, setMode] = useState<NoteMode>('wysiwyg');

  // `?folder=` pre-fills the destination when "+" was pressed while standing in
  // a folder; `?type=` pre-picks what the Create panel chose.
  const folder = params.get('folder') ?? '';
  const typeParam = params.get('type');
  // `?type=` is only a pre-pick, so a value that names no built-in shape is
  // read as one of the space's own note types instead (the Create panel's
  // "New type" lands here with one, and `?new=1` says to register it).
  const initialType: DraftKind | null = isDraftKind(typeParam) ? typeParam : null;
  const initialCustomType = typeParam && !initialType ? typeParam : null;
  const initialTypeIsNew = !!initialCustomType && params.get('new') === '1';
  const initialAlias = params.get('alias');
  const initialAgentTemplate = initialType === 'agent' ? params.get('template') : null;

  // A kind with no prose in front of it has no editor to switch, so it gets
  // no tab bar either. Until a type is picked this genuinely is a note, and a
  // custom type narrows one, so both of those keep the pair.
  const hasProse = draftHasProse(initialType);
  const activeTab = mode === 'raw' ? 'raw' : 'context';

  const handleSelect = useCallback((id: string) => {
    setMode(id === 'raw' ? 'raw' : 'wysiwyg');
  }, []);

  // The bar is the shell's; this page registers its tab set and renders its own
  // draft surface, whose panel portals a toolbar into the shell's host.
  usePaneChrome({
    tabs: hasProse ? DRAFT_TABS : null,
    activeId: activeTab,
    onSelect: handleSelect,
    // Only wysiwyg portals a toolbar into the attached region; Raw is a plain
    // textarea, so the bar stays one row tall there.
    attachedOpen: hasProse && activeTab === 'context',
    ariaLabel: 'Note sections',
    surface: null,
  });

  return (
    <div className="w-full pb-10">
      <div className="profile-enter">
        <DraftContextPanel
          mode={mode}
          initialFolder={folder}
          initialType={initialType}
          initialCustomType={initialCustomType}
          initialTypeIsNew={initialTypeIsNew}
          initialAlias={initialAlias}
          initialAgentTemplate={initialAgentTemplate}
        />
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
