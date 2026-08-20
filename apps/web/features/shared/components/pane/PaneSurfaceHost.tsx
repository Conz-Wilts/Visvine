'use client';

// The shell-rendered note surface: context tree column + note/entity panel,
// mounted once in directory/layout.tsx and re-pointed by the pages via
// PaneShellContext rather than remounted per navigation.
//
// The panels latch the note they're showing so a path/node change swaps editor
// and toolbar pill in one commit. That only works when the new path/node
// arrives as a PROP, which per-page mounting never produced.
//
// Cross-kind swaps (note↔entity) can't bridge with a prop change, so each panel
// kind gets a stable slot: the outgoing panel stays visible while the incoming
// one mounts hidden with its toolbar gated off (TabBarSlotGate); when the
// incoming panel reports ready, one commit flips both flags without remounting
// it. The toolbar tray never empties, so it only plays its drop-in when there
// genuinely was no toolbar before (Raw, the graph, a profile tab).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  CONNECTIONS_RAIL_W,
  useConnectionsRailVisible,
  useContextPanel,
} from '@/features/shared/contexts/ContextPanelContext';
import ContentReveal from '@/components/ui/ContentReveal';
import { TabBarSlotGate } from '@/features/shared/contexts/TabBarSlotContext';
import { entityOwnerPathOf } from '@/lib/notes/entities';
import {
  paneSurfaceKey,
  usePaneChromeState,
  type PaneSurface,
} from '@/features/shared/contexts/PaneShellContext';

// Tiptap + the notes stack load only when a note surface actually renders.
const NoteContextPanel = dynamic(
  () => import('@/features/notes/components/NoteContextPanel').then((m) => m.NoteContextPanel),
  { ssr: false, loading: () => null },
);
const EntityContextPanel = dynamic(
  () => import('@/features/notes/components/EntityContextPanel').then((m) => m.EntityContextPanel),
  { ssr: false, loading: () => null },
);
const ContextSidebar = dynamic(
  () => import('@/features/notes/components/ContextSidebar').then((m) => m.ContextSidebar),
  { ssr: false, loading: () => null },
);
const ConnectionsRail = dynamic(
  () => import('@/features/notes/components/ConnectionsRail'),
  { ssr: false, loading: () => null },
);

/** How long a cross-kind swap may wait on the incoming panel before committing
 *  anyway. */
const SWAP_STUCK_MS = 2500;

type PanelSurface = Extract<NonNullable<PaneSurface>, { kind: 'note' } | { kind: 'entity' }>;
const isPanel = (s: PaneSurface): s is PanelSurface =>
  s?.kind === 'note' || s?.kind === 'entity';

/** Which note/entity is open, ignoring mode — Context⇄Raw on the same note is
 *  not "a different thing opened". An entity's sub-notes are different things
 *  (each is its own note under the same chrome); the entity's own note is
 *  identified by the node alone, so its path resolving after the node fetch
 *  doesn't read as a switch. */
function identityOf(s: PaneSurface): string {
  if (!s) return 'none';
  if (s.kind === 'tree-only') return 'tree';
  if (s.kind === 'note') return `note:${s.path}`;
  const sub = s.notePath && entityOwnerPathOf(s.notePath) ? `#${s.notePath}` : '';
  return `entity:${s.nodeId}${sub}`;
}

/** Inset for the note content so the connections rail doesn't cover it. On
 *  THIS element rather than on the shell's <main> — the pane's tab row lives in
 *  <main> too and must keep the full width of the card, so narrowing the
 *  scroller itself would drag the row (and the navbar seam it continues)
 *  across with it. The tree needs no inset: it is a flex column beside the
 *  note, not a panel over it. */
function useRailInsetStyle(railVisible: boolean): React.CSSProperties {
  return {
    paddingRight: railVisible ? CONNECTIONS_RAIL_W : undefined,
    transition: 'padding 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
  };
}

export default function PaneSurfaceHost() {
  const { chrome } = usePaneChromeState();
  const target = chrome?.surface ?? null;
  const { connectionsOpen } = useContextPanel();
  const railInsetStyle = useRailInsetStyle(useConnectionsRailVisible());

  // The rail slides rather than popping, so closing can't unmount it in the
  // same commit — it stays mounted (open=false, sliding offscreen) until the
  // transition has had its 300ms, then leaves the tree.
  const [railMounted, setRailMounted] = useState(connectionsOpen);
  if (connectionsOpen && !railMounted) setRailMounted(true);
  useEffect(() => {
    if (connectionsOpen) return;
    const done = setTimeout(() => setRailMounted(false), 350);
    return () => clearTimeout(done);
  }, [connectionsOpen]);

  // The surface currently on screen. Follows `target` immediately except while
  // it must lag: a cross-kind swap (until the incoming panel is ready), or a
  // `tree-only` target while a panel is up. tree-only is a loading state — the
  // entity pages register it while their node fetch resolves — and dropping the
  // panel for that window tore the toolbar pill out mid-navigation.
  const [shown, setShown] = useState<PaneSurface>(target);
  const holdForTree = isPanel(shown) && target?.kind === 'tree-only';
  const crossKind = isPanel(shown) && isPanel(target) && shown.kind !== target.kind;
  if (!crossKind && !holdForTree && paneSurfaceKey(shown) !== paneSurfaceKey(target)) {
    // Render-phase adjustment: same-kind changes go straight through, since the
    // panel's own latch handles the fetch window.
    setShown(target);
  }

  const targetRef = useRef(target);
  targetRef.current = target;
  // Latest target, not the one the swap started for: a second navigation
  // mid-swap must land where the user actually is.
  const commitSwap = useCallback(() => setShown(targetRef.current), []);

  // Failsafe for both lag states, so a hung fetch can't wedge the old panel on
  // screen indefinitely.
  const lagging = crossKind || holdForTree;
  useEffect(() => {
    if (!lagging) return;
    const bail = setTimeout(commitSwap, SWAP_STUCK_MS);
    return () => clearTimeout(bail);
  }, [lagging, commitSwap]);

  const active = lagging ? shown : target;
  const activeIsPanel = isPanel(active);
  const activeIdentity = identityOf(active);
  const activeKind = isPanel(active) ? active.kind : null;
  const activeKindRef = useRef(activeKind);
  activeKindRef.current = activeKind;

  // The reveal plays once per entry into a note surface and then stays open;
  // switching notes swaps content behind an already-visible surface. Reset only
  // when the panel surface goes away.
  const [revealReady, setRevealReady] = useState(false);
  useEffect(() => {
    if (!activeIsPanel) setRevealReady(false);
  }, [activeIsPanel]);

  // The visible slot's ready lifts the reveal; a hidden slot reporting ready is
  // the incoming half of a cross-kind swap and commits it. Read through a ref —
  // a slot's role can flip between passing the callback and firing it.
  const handleNoteReady = useCallback(() => {
    if (activeKindRef.current === 'note') setRevealReady(true);
    else commitSwap();
  }, [commitSwap]);
  const handleEntityReady = useCallback(() => {
    if (activeKindRef.current === 'entity') setRevealReady(true);
    else commitSwap();
  }, [commitSwap]);

  // A persistent surface must scroll back to the top explicitly where a fresh
  // page mount used to imply it. Panel→panel only: entering from a profile tab
  // keeps the user's scroll position.
  const prevIdentityRef = useRef(activeIdentity);
  useEffect(() => {
    const prev = prevIdentityRef.current;
    prevIdentityRef.current = activeIdentity;
    const isNote = (id: string) => id !== 'none' && id !== 'tree';
    if (activeIdentity !== prev && isNote(activeIdentity) && isNote(prev)) {
      document.querySelector('main')?.scrollTo({ top: 0 });
    }
  }, [activeIdentity]);

  if (!active) return null;
  if (active.kind === 'tree-only') {
    return (
      <div className="flex w-full items-start pb-10">
        <ContextSidebar currentPath={active.notePath} />
      </div>
    );
  }

  const treePath = active.kind === 'note' ? active.path : active.notePath;

  // Outside a cross-kind swap exactly one slot is non-null; during one, the
  // outgoing kind holds `active` (visible) and the incoming kind holds `target`
  // (hidden + toolbar-gated).
  const noteSurface =
    active.kind === 'note' ? active : crossKind && target?.kind === 'note' ? target : null;
  const entitySurface =
    active.kind === 'entity' ? active : crossKind && target?.kind === 'entity' ? target : null;

  return (
    // The tree sits outside the reveal: it is already on screen from the last
    // surface, so only the note fades in. The rail's inset is the reveal's
    // padding-right (see useRailInsetStyle), so the note body makes room for it
    // while the pane's tab row above keeps the full width of the card.
    <div className="flex w-full items-start">
    <ContextSidebar currentPath={treePath} />
    <ContentReveal
      ready={revealReady}
      className="min-w-0 flex-1 pb-10 motion-reduce:[transition:none!important]"
      style={railInsetStyle}
    >
      {railMounted && <ConnectionsRail path={treePath} open={connectionsOpen} />}
      {noteSurface && (
        <div hidden={active.kind !== 'note'}>
          <TabBarSlotGate suppressed={active.kind !== 'note'}>
            <NoteContextPanel path={noteSurface.path} mode={noteSurface.mode} onReady={handleNoteReady} />
          </TabBarSlotGate>
        </div>
      )}
      {entitySurface && (
        <div hidden={active.kind !== 'entity'}>
          <TabBarSlotGate suppressed={active.kind !== 'entity'}>
            <EntityContextPanel
              nodeId={entitySurface.nodeId}
              notePath={entitySurface.notePath}
              mode={entitySurface.mode}
              onReady={handleEntityReady}
            />
          </TabBarSlotGate>
        </div>
      )}
    </ContentReveal>
    </div>
  );
}
