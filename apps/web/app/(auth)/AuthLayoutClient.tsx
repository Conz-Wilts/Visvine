"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/features/shared/components/layout/Sidebar";
import { HeaderProvider } from "@/features/shared/contexts/HeaderContext";
import Navbar from "@/features/shared/components/layout/Navbar";
import { CommunityProvider, useCommunity } from "@/features/shared/contexts/CommunityContext";
import { FEATURES, canAccessFeature, defaultLandingHref } from "@/features/shared/lib/features";
import { COLLAPSED_W, EXPANDED_W } from "@/features/shared/components/layout/Sidebar";
import type { CommunityFeatureConfig } from "@/lib/types";
import { CommunityDesignProvider } from "@/features/shared/contexts/CommunityDesignContext";
import { ProfileProvider } from "@/features/shared/contexts/ProfileContext";
import {
  ThemeProvider,
  SHELL_FRAME_GAP,
  SHELL_FRAME_MARGIN,
  SHELL_FRAME_RADIUS,
} from "@/features/shared/contexts/ThemeContext";
import { CreateModalProvider } from "@/features/shared/contexts/CreateModalContext";
import { SidebarProvider, useSidebar } from "@/features/shared/contexts/SidebarContext";
import { ContextPanelProvider, useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { FullProfileProvider } from "@/features/shared/contexts/FullProfileContext";
import { AuthProvider } from "@/features/auth/contexts/AuthContext";
import type { Community } from "@/lib/types";
import type { Session } from "@/features/auth/lib/auth-client";
import type { InitialMembership } from "@/features/shared/contexts/CommunityContext";

// If this user can't open the feature whose page is currently on screen —
// either the community removed it, or the tool is admins-only and they're a
// member — bounce to the first feature they can still see. The
// matching feature must own the path prefix — so /directory/foo is guarded too.
function useFeatureRouteGuard() {
  const { currentCommunity, loading, isAdmin } = useCommunity();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading || !currentCommunity) return;
    const config = (currentCommunity.featureConfig as CommunityFeatureConfig | undefined) ?? null;
    const onFeature = FEATURES.find(
      (f) => pathname === f.href || pathname.startsWith(f.href + "/")
    );
    if (onFeature && !canAccessFeature(config, onFeature.key, isAdmin)) {
      router.replace(defaultLandingHref(config, isAdmin));
    }
  }, [currentCommunity, loading, isAdmin, pathname, router]);
}

function AuthLayoutInner({ children }: { children: React.ReactNode }) {
  const { expanded } = useSidebar();
  const { railInset } = useContextPanel();
  const pathname = usePathname();
  useFeatureRouteGuard();

  // /channels is a Slack-style full-bleed surface: panels run edge-to-edge and
  // scroll internally, so the shell drops its gutters and scroll container.
  const fullBleed = pathname.startsWith("/channels");

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

  // Colour frame: the shell stays white and an accent-coloured rounded box
  // sits in the content region (below the navbar, right of the rail, inset from
  // the viewport right/bottom by SHELL_FRAME_MARGIN of white — mirroring the
  // white the navbar/rail provide on the other two sides). <main> becomes a
  // white rounded card INSIDE that box (its padding), so the colour is a
  // background the body floats on, not margins the body can rubber-band out of.
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

      {/* Main content: the frame box sits right of the rail (marginLeft: railW)
          and below the navbar (marginTop: 64). <main> is the scroll container,
          so its scrollbar starts under the navbar rather than at the viewport
          top. Each page supplies its own 24px horizontal padding (px-6). */}
      <div
        className="flex-1 min-h-0"
        style={{
          marginTop: 64,
          marginLeft: railW,
          marginRight: SHELL_FRAME_MARGIN,
          marginBottom: SHELL_FRAME_MARGIN,
          padding: SHELL_FRAME_GAP,
          background: "var(--shell-frame, #ffffff)",
          // Concentric with the card: outer radius = card radius + the gap.
          borderRadius: SHELL_FRAME_RADIUS + SHELL_FRAME_GAP,
          transition: "margin-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
        }}
      >
        {/* The clip wrapper owns the radius: <main>'s scrollbar paints a
            square track inside <main>'s own border box, so a radius on
            <main> itself leaves the track's corners poking white notches
            into the frame band. A rounded overflow-hidden parent clips the
            scrollbar along with the content. */}
        <div className="h-full overflow-hidden" style={{ borderRadius: SHELL_FRAME_RADIUS }}>
          <main
            className={fullBleed ? "h-full overflow-hidden" : "h-full pt-4 pb-6 scroll-pt-32 overflow-y-auto overscroll-y-none"}
            style={{
              // Full 24px like the classic shell: pane bars bleed into the
              // gutter with -ml-6 (24px), so a smaller padding here makes
              // them overshoot the card edge and clip (the Grid underline
              // lost its left inset).
              paddingLeft: fullBleed ? 0 : 24,
              background: "var(--color-surface-1, #ffffff)",
              // No horizontal scrolling: a sideways drag would slide content
              // under the fixed rail / docked panel, which read as broken.
              overflowX: "hidden",
              // The connections rail's strip, taken as a BORDER rather than
              // padding: a scroller paints its scrollbar inside its border box,
              // so the page bar travels left with the rail and stays visible —
              // as padding it would stay pinned at the card edge, under a panel
              // that has a scrollbar of its own. Transparent, so the card's own
              // surface shows through while the rail slides across it.
              borderRight: `${railInset}px solid transparent`,
              transition: "border-right-width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
              ...(fullBleed ? {} : { scrollbarGutter: 'stable' as const }),
            }}
          >
            {mainInner}
          </main>
        </div>
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
  initialCommunities?: Community[];
  initialMemberships?: InitialMembership[];
}

export default function AuthLayoutClient({
  children,
  initialSession,
  initialCommunities,
  initialMemberships,
}: AuthLayoutClientProps) {
  return (
    <AuthProvider initialSession={initialSession}>
    <ThemeProvider>
      <CommunityProvider initialCommunities={initialCommunities} initialMemberships={initialMemberships}>
        <CommunityDesignProvider>
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
        </CommunityDesignProvider>
      </CommunityProvider>
    </ThemeProvider>
    </AuthProvider>
  );
}
