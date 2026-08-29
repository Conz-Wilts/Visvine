'use client';

// Registration store for the pane shell — the seam that lets the /directory
// routes share one persistent tab bar + note surface (see features/shared/components/pane/*).
// The App Router remounts the page subtree on every navigation, so the chrome
// lives in directory/layout.tsx and each page declares what it should show by
// registering a PaneChromeConfig here.
//
// Pages stay the contexts: the tab set depends on things only a page knows (node
// type from a client fetch, ?tab= semantics, the Directory's local view state),
// so the shell is a dumb, persistent renderer.
//
// Store semantics:
//  - Last-writer-wins, re-registered on every commit; no-op writes are dropped.
//  - NOT cleared on unmount — holding the last config is what keeps the bar
//    from blinking while pages swap. So every page under the shell MUST
//    register, even branches with no chrome (tabs: null); one that registers
//    nothing leaves the previous page's chrome on screen.
//  - onSelect lives in a ref, and select() is ignored once the registrant's
//    pathname no longer matches the live one, so a click in the gap between
//    pages can't fire the dead page's handler.

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import type { NoteMode } from '@/features/notes/components/NoteModeToggle';

export interface PaneTabItem {
  id: string;
  label: string;
}

/** What the shell should render below the bar. `note`/`entity` are the two
 *  persistent note panels; `tree-only` docks the context tree with no panel
 *  yet (a note tab arriving before its node has resolved); `null` means the
 *  page renders its own body (profile, grid, preview, draft, source). */
export type PaneSurface =
  | { kind: 'note'; path: string; mode: NoteMode }
  | { kind: 'entity'; nodeId: string; notePath: string | null; mode: NoteMode }
  | { kind: 'tree-only'; notePath: string | null }
  | null;

export interface PaneChromeConfig {
  /** null = no tab bar at all (source view, error states). */
  tabs: PaneTabItem[] | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  /** The toolbar tray region under the tab row (0fr↔1fr) is open. */
  attachedOpen: boolean;
  /** Show the Raw editor-mode toggle in the bar's trailing chrome (beside
   *  Connections). Clicks dispatch select('raw'); the on state is read off the
   *  surface's mode, so the registrant owns the actual toggle. */
  rawToggle?: boolean;
  ariaLabel?: string;
  surface: PaneSurface;
}

/** What the store actually holds: the config minus the callback, plus the
 *  pathname it was registered from (the stale-click guard). */
export interface PaneChromeState extends Omit<PaneChromeConfig, 'onSelect'> {
  pathname: string;
}

export function paneSurfaceKey(s: PaneSurface): string {
  if (!s) return 'none';
  switch (s.kind) {
    case 'note':
      return `note:${s.path}:${s.mode}`;
    case 'entity':
      return `entity:${s.nodeId}:${s.notePath ?? ''}:${s.mode}`;
    case 'tree-only':
      return `tree:${s.notePath ?? ''}`;
  }
}

function tabsKeyOf(tabs: PaneTabItem[] | null): string {
  return tabs ? tabs.map((t) => `${t.id}\0${t.label}`).join('|') : '∅';
}

function sameChrome(a: PaneChromeState | null, b: PaneChromeState): boolean {
  return (
    !!a &&
    a.pathname === b.pathname &&
    a.activeId === b.activeId &&
    a.attachedOpen === b.attachedOpen &&
    (a.rawToggle ?? false) === (b.rawToggle ?? false) &&
    a.ariaLabel === b.ariaLabel &&
    paneSurfaceKey(a.surface) === paneSurfaceKey(b.surface) &&
    tabsKeyOf(a.tabs) === tabsKeyOf(b.tabs)
  );
}

interface PaneShellValue {
  chrome: PaneChromeState | null;
  /** Forward a tab click to the registered page's onSelect. */
  select: (id: string) => void;
  register: (state: PaneChromeState, onSelect: (id: string) => void) => void;
}

const PaneShellContext = createContext<PaneShellValue | null>(null);

export function PaneShellProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<PaneChromeState | null>(null);
  const onSelectRef = useRef<(id: string) => void>(() => {});

  const register = useCallback((state: PaneChromeState, onSelect: (id: string) => void) => {
    onSelectRef.current = onSelect;
    // usePaneChrome registers on every page commit, so without this bail the
    // provider would re-render the shell each time too.
    setChrome((prev) => (sameChrome(prev, state) ? prev : state));
  }, []);

  const select = useCallback((id: string) => {
    onSelectRef.current(id);
  }, []);

  const value = useMemo(() => ({ chrome, select, register }), [chrome, select, register]);
  return <PaneShellContext.Provider value={value}>{children}</PaneShellContext.Provider>;
}

function usePaneShell(): PaneShellValue {
  const ctx = useContext(PaneShellContext);
  if (!ctx) throw new Error('Pane shell hooks must be used under PaneShellProvider (directory/layout.tsx)');
  return ctx;
}

/** Register this page's chrome with the persistent shell. Call unconditionally
 *  (it's a hook) on every /directory page, passing `tabs: null, surface: null`
 *  for branches with no chrome of their own. */
export function usePaneChrome(config: PaneChromeConfig): void {
  const { register } = usePaneShell();
  const pathname = usePathname();
  // Pre-paint and on every commit — a page's tab set changes with its data
  // (node loaded, counts arrived) and must reach the bar before it paints.
  useLayoutEffect(() => {
    const { onSelect, ...rest } = config;
    register({ ...rest, pathname }, onSelect);
  });
}

/** Shell-internal read of the live chrome + the click dispatcher. */
export function usePaneChromeState(): { chrome: PaneChromeState | null; select: (id: string) => void } {
  const { chrome, select } = usePaneShell();
  return { chrome, select };
}
