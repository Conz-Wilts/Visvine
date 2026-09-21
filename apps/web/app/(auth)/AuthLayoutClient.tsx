"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useSpaceRouter } from "@/features/shared/hooks/useSpaceRouter";
import { useRoutePathname } from "@/features/shared/hooks/useRoutePathname";
import Sidebar from "@/features/shared/components/layout/Sidebar";
import { HeaderProvider } from "@/features/shared/contexts/HeaderContext";
import ShellTopBar from "@/features/shared/components/layout/ShellTopBar";
import { SHELL_PANE_TOP, SHELL_TOP_BAR_H } from "@/features/shared/contexts/ThemeContext";
import { SpaceProvider, useSpace } from "@/features/shared/contexts/SpaceContext";
import { FEATURES, canAccessFeature, defaultLandingHref } from "@/features/shared/lib/features";
import { EXPANDED_W } from "@/features/shared/components/layout/railRow";
import { FRAME_BG, FRAME_LINE, FRAME_RADIUS, useDesktopChrome } from "@/features/desktop/lib/chrome";
import type { SpaceFeatureConfig } from "@/lib/types";
import { SpaceDesignProvider } from "@/features/shared/contexts/SpaceDesignContext";
import { ProfileProvider } from "@/features/shared/contexts/ProfileContext";
import {
  ThemeProvider,
} from "@/features/shared/contexts/ThemeContext";
import { CreateModalProvider } from "@/features/shared/contexts/CreateModalContext";
import { SidebarProvider, useSidebar } from "@/features/shared/contexts/SidebarContext";
import { ContextPanelProvider } from "@/features/shared/contexts/ContextPanelContext";
import { AuthProvider } from "@/features/auth/contexts/AuthContext";
import type { Space } from "@/lib/types";
import type { Session } from "@/features/auth/lib/auth-client";
import type { InitialMembership } from "@/features/shared/contexts/SpaceContext";
import type { LockedSubspace } from "@/lib/spaces/subspaceAccess";

// If this user can't open the feature whose page is currently on screen —
// either the space removed it, or the tool is admins-only and they're a
// member — bounce to the first feature they can still see. The
// matching feature must own the path prefix — so /directory/foo is guarded too.
function useFeatureRouteGuard() {
  const { currentSpace, loading, isAdmin } = useSpace();
  const pathname = useRoutePathname();
  const router = useSpaceRouter();

  useEffect(() => {
    if (loading || !currentSpace) return;
    const config = (currentSpace.featureConfig as SpaceFeatureConfig | undefined) ?? null;
    const onFeature = FEATURES.find(
      (f) => pathname === f.href || pathname.startsWith(f.href + "/")
    );
    if (onFeature && !canAccessFeature(config, onFeature.key, isAdmin)) {
      router.replace(defaultLandingHref(config, isAdmin, currentSpace.installedTools));
    }
  }, [currentSpace, loading, isAdmin, pathname, router]);
}

/** Set by a pane that sizes itself to the viewport and scrolls inside itself.
 *  <main> reserves a scrollbar gutter it never uses for such a pane, and 8px of
 *  dead white down the right is exactly where a full-bleed grid's own edge
 *  should be. Told by the pane rather than read off the path, because it is one
 *  VIEW of a route: the Directory's Table, not /directory. */
const ViewportPaneContext = createContext<(fills: boolean) => void>(() => {});

/** Declare, for as long as this component is mounted, that the pane fills the
 *  viewport and <main> has nothing to scroll. */
export function useViewportPane(fills = true) {
  const declare = useContext(ViewportPaneContext);
  useEffect(() => {
    declare(fills);
    return () => declare(false);
  }, [declare, fills]);
}

function AuthLayoutInner({ children }: { children: React.ReactNode }) {
  const { expanded } = useSidebar();
  const [viewportPane, setViewportPane] = useState(false);
  const pathname = useRoutePathname();
  useFeatureRouteGuard();

  // /channels is a Slack-style full-bleed surface: panels run edge-to-edge and
  // scroll internally, so the shell drops its gutters and scroll container.
  // An installed Tool's page (/t/<slug>) is the same shape: the frame IS the
  // pane, sized to it and scrolling inside itself, so the shell must not add a
  // second scroll container around it.
  const fullBleed = pathname.startsWith("/channels") || pathname.startsWith("/t/");

  // Every page scrolls inside <main> — not on the document — so <main> owns its
  // own scroll padding and gutter. (/context is immersive: it pins body overflow
  // itself and never scrolls this container.)
  //
  // overscroll-y-none is load-bearing, not cosmetic: <main> is a nested
  // scroller, so on macOS a fast flick past either end rubber-bands it. A
  // `sticky` tab bar can't hold above its rest position, so it would ride that
  // bounce down and visibly unstick. Killing the bounce keeps every page's
  // sticky top bar welded to the top of the surface.

  const { railW: collapsedW } = useDesktopChrome();
  const railW = expanded ? EXPANDED_W : collapsedW;

  const mainInner = fullBleed ? (
    <div className="h-full">{children}</div>
  ) : (
    <div style={{ minHeight: `calc(100dvh - ${SHELL_TOP_BAR_H + SHELL_PANE_TOP + 24}px)` }}>
      {children}
    </div>
  );

  const railMotion = "0.3s cubic-bezier(0.25, 0.1, 0.25, 1)";

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: FRAME_BG }}
    >
      {/* The shell is a frame (features/desktop/lib/chrome.ts): the band runs
          the window's full width, the rail hangs under it, and the page's tabs
          and actions sit in the band rather than on the sheet below. */}
      <ShellTopBar leftInset={railW} />
      {/* The sidebar is the shell's only chrome: it runs the full height of the
          viewport, fixed over the content's left edge. */}
      <Sidebar />

      {/* Main content: one flat surface right of the rail (marginLeft: railW),
          running to the top of the viewport. <main> is the scroll container, so
          its scrollbar is the surface's own. Each page supplies its own 24px
          horizontal padding (px-6). */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{
          marginLeft: railW,
          transition: `margin-left ${railMotion}`,
          // The content is a sheet set into the frame: one hairline along the
          // band and the rail, rounded where they meet.
          background: "var(--color-surface-1)",
          borderTop: FRAME_LINE,
          borderLeft: FRAME_LINE,
          borderTopLeftRadius: FRAME_RADIUS,
          overflow: "hidden",
        }}
      >
        <main
          className={fullBleed ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 pb-6 scroll-pt-32 overflow-y-auto overscroll-y-none"}
          style={{
            // The clearance above anything a page pins at the top of the
            // surface. The bars cancel it and repaint it themselves, so it is
            // one number (SHELL_PANE_TOP) rather than a pt-* they must match.
            paddingTop: fullBleed ? 0 : SHELL_PANE_TOP,
            // Full 24px like the classic shell: pane bars bleed into the
            // gutter with -ml-6 (24px), so a smaller padding here makes
            // them overshoot the surface edge and clip (the Grid underline
            // lost its left inset).
            paddingLeft: fullBleed ? 0 : 24,
            // No background of its own: the body's backdrop shows through.
            // No horizontal scrolling: a sideways drag would slide content
            // under the fixed rail / docked panel, which read as broken.
            overflowX: "hidden",
            // Nothing is reserved for the connections rail: it's a pure
            // overlay over the surface's right edge, so opening it never
            // narrows <main> and never shifts the pane's tab row across.
            // A pane that fills the viewport (the Directory's Table) has
            // nothing for <main> to scroll, so the reserved gutter is 8px of
            // dead white between its right edge and the screen's.
            ...(fullBleed || viewportPane ? {} : { scrollbarGutter: 'stable' as const }),
          }}
        >
          <ViewportPaneContext.Provider value={setViewportPane}>
            {mainInner}
          </ViewportPaneContext.Provider>
        </main>
      </div>

      {/* The Create panel is NOT here — it lives inside the Sidebar's docked
          column (it takes that column over while open), see Sidebar.tsx. */}
    </div>
  );
}

interface AuthLayoutClientProps {
  children: React.ReactNode;
  /** Server-hydrated data from the (auth) layout — skips the mount fetch waterfall. */
  initialSession?: Session | null;
  initialSpaces?: Space[];
  initialMemberships?: InitialMembership[];
  initialLockedSubspaces?: LockedSubspace[];
}

export default function AuthLayoutClient({
  children,
  initialSession,
  initialSpaces,
  initialMemberships,
  initialLockedSubspaces,
}: AuthLayoutClientProps) {
  return (
    <AuthProvider initialSession={initialSession}>
    <ThemeProvider>
      <SpaceProvider
        initialSpaces={initialSpaces}
        initialMemberships={initialMemberships}
        initialLockedSubspaces={initialLockedSubspaces}
      >
        <SpaceDesignProvider>
        <ProfileProvider>
          <HeaderProvider>
              <SidebarProvider>
              <ContextPanelProvider>
              <CreateModalProvider>
                              <AuthLayoutInner>
                  {children}
                </AuthLayoutInner>
                            </CreateModalProvider>
              </ContextPanelProvider>
              </SidebarProvider>
          </HeaderProvider>
        </ProfileProvider>
        </SpaceDesignProvider>
      </SpaceProvider>
    </ThemeProvider>
    </AuthProvider>
  );
}
