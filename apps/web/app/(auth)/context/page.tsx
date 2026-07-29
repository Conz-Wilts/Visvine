'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import ChatInterface from '@/components/chat/ChatInterface';
import { entityNotePath } from '@/lib/notes/entities';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';

// The context pulls in d3-force + the canvas renderer. Defer the whole thing so
// other pages never download it.
const DirectoryContextView = dynamic(() => import('@/components/dashboard/DirectoryContextView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading context…</div>
  ),
});

// The community context tree, docked into the global Sidebar (portal) on wide
// viewports — same instance the profile Context tab uses.
const ContextSidebar = dynamic(
  () => import('@/features/notes/components/ContextSidebar').then((m) => m.ContextSidebar),
  { ssr: false },
);

/**
 * The Context tool: the community context, full-bleed and immersive, with the
 * notes tree dockable into the Sidebar. Search dims non-matching nodes and
 * focuses the best match rather than filtering.
 */
export default function ContextPage() {
  const [searchTerm, setSearchTerm] = useState('');
  // The search's best-matching node, lifted out of the context so the docked
  // notes tree can scroll to that entity's note alongside the context focus.
  const [focusNode, setFocusNode] = useState<{ id: string; type: string } | null>(null);
  const focusPath = focusNode ? entityNotePath(focusNode) : null;
  // While the notes tree is docked into the Sidebar the sidebar card widens by
  // CONTEXT_PANEL_W, but <main>'s left padding only clears the icon rail — the
  // page must inset itself or the panel covers the search bar and context edge.
  // dockRequested is already wide-gated (≥1024px) by ContextSidebar.
  const { dockRequested, contextOpen } = useContextPanel();
  const dockInset = dockRequested && contextOpen ? CONTEXT_PANEL_W : 0;

  // The context owns its surface: fixed-height container, no page scroll.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    // marginLeft (not padding): the search + canvas are absolutely positioned,
    // and absolute children resolve against the padding box, so padding would
    // be ignored. A block with auto width shrinks to clear the margin instead.
    <div
      className="relative"
      data-tour="context-canvas"
      style={{
        height: 'calc(100vh - 5rem - 3rem)',
        overflow: 'hidden',
        marginLeft: dockInset || undefined,
        transition: 'margin-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
      }}
    >
      {/* Search floats over the canvas */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-2xl px-6">
        <div className="flex-1 flex items-center gap-3">
          <div className="flex-1">
            <ChatInterface
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search…"
              hideSubmitButton
            />
          </div>
        </div>
      </div>

      {/* Context canvas — persisted layout restores on remount, so navigating away
          and back costs one cheap redraw instead of a re-simulation. */}
      <div className="overflow-hidden rounded-xl absolute inset-0 px-6">
        <DirectoryContextView searchTerm={searchTerm} onFocusNodeChange={setFocusNode} />
      </div>

      {/* Marks the notes tree dockable + portals it into the Sidebar host. */}
      <ContextSidebar currentPath={null} focusPath={focusPath} />
    </div>
  );
}
