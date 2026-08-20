"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/features/shared/components/layout/Sidebar";
import { HeaderProvider } from "@/features/shared/contexts/HeaderContext";
import Navbar from "@/features/shared/components/layout/Navbar";
import { SpaceProvider, useSpace } from "@/features/shared/contexts/SpaceContext";
import { FEATURES, canAccessFeature, defaultLandingHref } from "@/features/shared/lib/features";
import { COLLAPSED_W, EXPANDED_W } from "@/features/shared/components/layout/Sidebar";
import type { SpaceFeatureConfig } from "@/lib/types";
import { SpaceDesignProvider } from "@/features/shared/contexts/SpaceDesignContext";
import { ProfileProvider } from "@/features/shared/contexts/ProfileContext";
import {
  ThemeProvider,
} from "@/features/shared/contexts/ThemeContext";
import { CreateModalProvider } from "@/features/shared/contexts/CreateModalContext";
import { SidebarProvider, useSidebar } from "@/features/shared/contexts/SidebarContext";
import { ContextPanelProvider } from "@/features/shared/contexts/ContextPanelContext";
import { FullProfileProvider } from "@/features/shared/contexts/FullProfileContext";
import { AuthProvider } from "@/features/auth/contexts/AuthContext";
import type { Space } from "@/lib/types";
import type { Session } from "@/features/auth/lib/auth-client";
import type { InitialMembership } from "@/features/shared/contexts/SpaceContext";

// If this user can't open the feature whose page is currently on screen —
// either the space removed it, or the tool is admins-only and they're a
// member — bounce to the first feature they can still see. The
// matching feature must own the path prefix — so /directory/foo is guarded too.
function useFeatureRouteGuard() {
  const { currentSpace, loading, isAdmin } = useSpace();
  const pathname = usePathname();
  const router = useRouter();

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

function AuthLayoutInner({ children }: { children: React.ReactNode }) {
  const { expanded } = useSidebar();
  const pathname = usePathname();
  useFeatureRouteGuard();

  // /channels is a Slack-style full-bleed surface: panels run edge-to-edge and
  // scroll internally, so the shell drops its gutters and scroll container.
  // An installed Tool's page (/t/<slug>) is the same shape: the frame IS the
  // pane, sized to it and scrolling inside itself, so the shell must not add a
  // second scroll container around it.
  const fullBleed = pathname.startsWith("/channels") || pathname.startsWith("/t/");

  // Every page scrolls inside <main> — not on the document — so the green
  // scrollbar starts BELOW the fixed navbar instead of running up its right
  // edge to the top of the viewport. (/context is immersive: it pins body
  // overflow itself and never scrolls this container.)
  //
  // overscroll-y-none is load-bearing, not cosmetic: <main> is a nested
  // scroller, so on macOS a fast flick past either end rubber-bands it. A
  // `sticky` tab bar can't hold above its rest position, so it rides that
  // bounce down while the fixed navbar stays put — the bar visibly unsticks.
  // Killing the bounce keeps every page's sticky top bar welded to the navbar.

  const railW = expanded ? EXPANDED_W : COLLAPSED_W;

  const mainInner = fullBleed ? (
    <div className="h-full">{children}</div>
  ) : (
    <div style={{ minHeight: 'calc(100vh - 5rem - 3rem)' }}>
      {children}
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-brand-bg">
      <Navbar />

      {/* Sidebar floats fixed over content — shadow not clipped */}
      <Sidebar />

      {/* Main content: one flat white surface right of the rail (marginLeft:
          railW) and below the navbar (marginTop: 64). <main> is the scroll
          container, so its scrollbar starts under the navbar rather than at
          the viewport top. Each page supplies its own 24px horizontal padding
          (px-6). */}
      <div
        className="flex-1 min-h-0"
        style={{
          marginTop: 64,
          marginLeft: railW,
          transition: "margin-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
        }}
      >
        <main
          className={fullBleed ? "h-full overflow-hidden" : "h-full pt-4 pb-6 scroll-pt-32 overflow-y-auto overscroll-y-none"}
          style={{
            // Full 24px like the classic shell: pane bars bleed into the
            // gutter with -ml-6 (24px), so a smaller padding here makes
            // them overshoot the surface edge and clip (the Grid underline
            // lost its left inset).
            paddingLeft: fullBleed ? 0 : 24,
            background: "var(--color-surface-1, #ffffff)",
            // No horizontal scrolling: a sideways drag would slide content
            // under the fixed rail / docked panel, which read as broken.
            overflowX: "hidden",
            // Nothing is reserved for the connections rail: it's a pure
            // overlay over the surface's right edge, so opening it never
            // narrows <main> and never shifts the pane's tab row across.
            ...(fullBleed ? {} : { scrollbarGutter: 'stable' as const }),
          }}
        >
          {mainInner}
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
}

export default function AuthLayoutClient({
  children,
  initialSession,
  initialSpaces,
  initialMemberships,
}: AuthLayoutClientProps) {
  return (
    <AuthProvider initialSession={initialSession}>
    <ThemeProvider>
      <SpaceProvider initialSpaces={initialSpaces} initialMemberships={initialMemberships}>
        <SpaceDesignProvider>
        <ProfileProvider>
          <HeaderProvider>
            <FullProfileProvider>
              <SidebarProvider>
              <ContextPanelProvider>
              <CreateModalProvider>
                <AuthLayoutInner>
                  {children}
                </AuthLayoutInner>
              </CreateModalProvider>
              </ContextPanelProvider>
              </SidebarProvider>
            </FullProfileProvider>
          </HeaderProvider>
        </ProfileProvider>
        </SpaceDesignProvider>
      </SpaceProvider>
    </ThemeProvider>
    </AuthProvider>
  );
}
