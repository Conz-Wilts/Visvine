"use client";

import Sidebar from "@/features/shared/components/layout/Sidebar";
import { HeaderProvider } from "@/lib/contexts/HeaderContext";
import Navbar from "@/components/layout/Navbar";
import { CommunityProvider } from "@/lib/contexts/CommunityContext";
import { CommunityDesignProvider, useCommunityDesign } from "@/lib/contexts/CommunityDesignContext";
import { ProfileProvider } from "@/lib/contexts/ProfileContext";
import { ThemeProvider } from "@/lib/contexts/ThemeContext";
import { CreateModalProvider } from "@/lib/contexts/CreateModalContext";
import CreateModal from "@/components/create/CreateModal";
import { SidebarProvider, useSidebar } from "@/lib/contexts/SidebarContext";
import { FullProfileProvider } from "@/lib/contexts/FullProfileContext";
import { AuthProvider } from "@/features/auth/contexts/AuthContext";

function AuthLayoutInner({ children }: { children: React.ReactNode }) {
  const { backgroundStyle } = useCommunityDesign();
  const { expanded } = useSidebar();
  return (
    <div className="flex flex-col min-h-screen bg-brand-bg" style={backgroundStyle}>
      <Navbar />

      {/* Sidebar floats fixed over content — shadow not clipped */}
      <Sidebar />

      {/* Main content: pl = sidebar's 24px left inset + sidebar width ONLY.
          The shell does NOT add the gutter — each page supplies its own 24px
          horizontal padding (px-6), which lands the content 24px to the right of
          the sidebar (matching the sidebar's own left inset) and 24px from the
          right edge. Collapsed: 24 + 64 = 88. Expanded: 24 + 200 = 224. */}
      <main
        className="flex-1 pt-4 pb-6 mt-20"
        style={{
          paddingLeft: expanded ? 224 : 88,
          transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
        }}
      >
        <div style={{ minHeight: 'calc(100vh - 5rem - 3rem)' }}>
          {children}
        </div>
      </main>

      {/* Global create modal */}
      <CreateModal />
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
              <CreateModalProvider>
                <AuthLayoutInner>
                  {children}
                </AuthLayoutInner>
              </CreateModalProvider>
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
