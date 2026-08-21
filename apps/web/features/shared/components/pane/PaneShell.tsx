'use client';

// Persistent chrome for everything under /directory, rendered by
// directory/layout.tsx so it survives navigation between the index, notes,
// profiles and drafts. Owns the registration store, the toolbar portal host,
// the tab bar, the note surface, and the docked column's top inset.

import React, { useEffect, useRef, type ReactNode } from 'react';
import { PaneShellProvider, usePaneChromeState } from '@/features/shared/contexts/PaneShellContext';
import { TabBarSlotProvider } from '@/features/shared/contexts/TabBarSlotContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import PaneTabBar, { dockTopInsetFor } from './PaneTabBar';
import PaneSurfaceHost from './PaneSurfaceHost';

export default function PaneShell({ children }: { children: ReactNode }) {
  return (
    <PaneShellProvider>
      <TabBarSlotProvider>
        <PaneShellBody>{children}</PaneShellBody>
      </TabBarSlotProvider>
    </PaneShellProvider>
  );
}

function PaneShellBody({ children }: { children: ReactNode }) {
  const { chrome } = usePaneChromeState();
  const { setDockTopInset, releaseDockNow } = useContextPanel();
  const hasBar = !!chrome?.tabs;

  // Leaving the shell entirely (/directory → /events): release the dock now.
  // The graced release only makes sense for surface-to-surface swaps inside the
  // shell. Parent cleanups run after children, so this wins over
  // ContextSidebar's deferred release on the same unmount.
  useEffect(() => () => releaseDockNow(), [releaseDockNow]);

  // Same immediacy within the shell when the registered surface goes away
  // (Context tab → Profile): nothing will re-claim the dock, so start closing
  // while the incoming body loads. Non-null → null transition only — the
  // Directory index registers surface: null while docking its own tree.
  const hasSurface = !!chrome?.surface;
  const hadSurfaceRef = useRef(hasSurface);
  useEffect(() => {
    const had = hadSurfaceRef.current;
    hadSurfaceRef.current = hasSurface;
    if (had && !hasSurface) releaseDockNow();
  }, [hasSurface, releaseDockNow]);

  // The one publisher of the docked column's top inset — pages must not also
  // publish it, or the two fight through their cleanup resets.
  useEffect(() => {
    setDockTopInset(hasBar ? dockTopInsetFor() : 0);
    return () => setDockTopInset(0);
  }, [setDockTopInset, hasBar]);

  return (
    // Plain block div on purpose: PaneTabBar is `sticky` and needs this tall
    // flow parent (no overflow/flex/height) as its direct ancestor, or it loses
    // its scroll range.
    <div className="w-full">
      <PaneTabBar />
      <PaneSurfaceHost>{children}</PaneSurfaceHost>
    </div>
  );
}
