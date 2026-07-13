"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/features/shared/components/layout/Sidebar";
import { HeaderProvider } from "@/lib/contexts/HeaderContext";
import Navbar from "@/components/layout/Navbar";
import { CommunityProvider, useCommunity } from "@/lib/contexts/CommunityContext";
import { FEATURES, canAccessFeature, visibleFeatures } from "@/lib/features";
import { NAV_HIDDEN_FEATURE_KEYS } from "@/lib/featureAccess";
import { COLLAPSED_W, EXPANDED_W } from "@/features/shared/components/layout/Sidebar";
import type { CommunityFeatureConfig } from "@/lib/types";
import { CommunityDesignProvider, useCommunityDesign } from "@/lib/contexts/CommunityDesignContext";
import { ProfileProvider } from "@/lib/contexts/ProfileContext";
import { ThemeProvider } from "@/lib/contexts/ThemeContext";
import { CreateModalProvider } from "@/lib/contexts/CreateModalContext";
import CreateModal from "@/components/create/CreateModal";
import { SidebarProvider, useSidebar } from "@/lib/contexts/SidebarContext";
import { ContextPanelProvider } from "@/lib/contexts/ContextPanelContext";
import { FullProfileProvider } from "@/lib/contexts/FullProfileContext";
import { AuthProvider } from "@/features/auth/contexts/AuthContext";
import TourLauncher from "@/features/onboarding/TourLauncher";

// If this user can't open the feature whose page is currently on screen —
// either the community switched it off, or the directory is admins-only and
// they're a member — bounce to the first feature they can still see. The
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
      const fallback =
        visibleFeatures(config, isAdmin).filter((f) => !NAV_HIDDEN_FEATURE_KEYS.includes(f.key))[0]?.href ?? "/";
      router.replace(fallback);
    }
  }, [currentCommunity, loading, isAdmin, pathname, router]);
}

function AuthLayoutInner({ children }: { children: React.ReactNode }) {
  const { backgroundStyle } = useCommunityDesign();
  const { expanded } = useSidebar();
  useFeatureRouteGuard();

  // Every page scrolls inside <main> — not on the document — so the green
  // scrollbar starts BELOW the fixed navbar instead of running up its right
  // edge to the top of the viewport. (/context, which used to own its scroll
  // via an overflow-visible special case, is a redirect now.)

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
        className="flex-1 mt-16 pt-4 pb-6 scroll-pt-32 overflow-y-auto"
        style={{
          paddingLeft: (expanded ? EXPANDED_W : COLLAPSED_W) + 24,
          scrollbarGutter: 'stable',
          transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
        }}
      >
        <div style={{ minHeight: 'calc(100vh - 5rem - 3rem)' }}>
          {children}
        </div>
      </main>

      {/* Global create modal */}
      <CreateModal />

      {/* One-time post-onboarding feature tour (no-op unless the flag is set) */}
      <TourLauncher />
    </div>
  );
}

export default function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
    <ThemeProvider>
      <CommunityProvider>
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
