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
import { CommunityDesignProvider, useCommunityDesign } from "@/features/shared/contexts/CommunityDesignContext";
import { ProfileProvider } from "@/features/shared/contexts/ProfileContext";
import { ThemeProvider } from "@/features/shared/contexts/ThemeContext";
import { CreateModalProvider } from "@/features/shared/contexts/CreateModalContext";
import { SidebarProvider, useSidebar } from "@/features/shared/contexts/SidebarContext";
import { ContextPanelProvider } from "@/features/shared/contexts/ContextPanelContext";
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
  const { backgroundStyle } = useCommunityDesign();
  const { expanded } = useSidebar();
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-brand-bg" style={backgroundStyle}>
      <Navbar />

      {/* Sidebar floats fixed over content — shadow not clipped */}
      <Sidebar />

      {/* Main content: pl = sidebar's 24px left inset + sidebar width ONLY.
          The shell does NOT add the gutter — each page supplies its own 24px
          horizontal padding (px-6), which lands the content 24px to the right of
          the sidebar (matching the sidebar's own left inset) and 24px from the
          right edge. Collapsed: 24 + COLLAPSED_W. Expanded: 24 + EXPANDED_W.
          <main> is the scroll container (mt-16 sits it below the fixed navbar), so
          its scrollbar starts under the navbar rather than at the viewport top. */}
      <main
        className={fullBleed ? "flex-1 mt-16 overflow-hidden" : "flex-1 mt-16 pt-4 pb-6 scroll-pt-32 overflow-y-auto overscroll-y-none"}
        style={{
          paddingLeft: (expanded ? EXPANDED_W : COLLAPSED_W) + (fullBleed ? 0 : 24),
          ...(fullBleed ? {} : { scrollbarGutter: 'stable' as const }),
          transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
        }}
      >
        {fullBleed ? (
          <div className="h-full">{children}</div>
        ) : (
          <div style={{ minHeight: 'calc(100vh - 5rem - 3rem)' }}>
            {children}
          </div>
        )}
      </main>

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
