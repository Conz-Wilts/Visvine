"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommunitySelector } from "@/features/communities";
import UserMenu from "@/components/auth/UserMenu";
import { useHeader } from "@/lib/contexts/HeaderContext";
import { useCommunity } from "@/lib/contexts/CommunityContext";
import { useContextPanel } from "@/lib/contexts/ContextPanelContext";
import { useSidebar, shellEntranceStyle } from "@/lib/contexts/SidebarContext";
import { useSession } from "@/lib/auth-client";
import { COLLAPSED_W, EXPANDED_W } from "@/features/shared/components/layout/Sidebar";

const SEAM_R = 10; // radius of the concave fillet joining the navbar to the sidebar rail

export default function Navbar() {
  const { headerContent, headerRight } = useHeader();
  const { isAdmin } = useCommunity();
  const { expanded, entered, reduced } = useSidebar();
  const { dockRequested, contextOpen, setContextOpen } = useContextPanel();
  const { data: session } = useSession();
  const pathname = usePathname();
  const eventsActive = pathname.startsWith("/events");
  const adminActive = pathname.startsWith("/admin");
  const canAccessAdmin = isAdmin || session?.user?.isSuperAdmin === true;

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-16 bg-white"
      style={shellEntranceStyle(entered, reduced)}
    >
      {/* Bottom border starts at the rail's current width (COLLAPSED_W ↔ EXPANDED_W)
          so no line ever crosses the top of the sidebar — the rail's right border
          continues the seam down, making the navbar + rail read as one continuous
          L-shaped shell. It stops SEAM_R short of the corner so the concave fillet
          below completes the seam with a curve. Transition matches the rail's width. */}
      <div
        className="absolute bottom-0 right-0 h-px bg-border-subtle"
        style={{ left: (expanded ? EXPANDED_W : COLLAPSED_W) + SEAM_R, transition: "left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)" }}
      />
      {/* Concave fillet at the navbar↔rail inner corner: the seam rounds INTO the
          navbar (a quarter-circle notch), not away from it. White fills the shell;
          the arc's hairline picks up where the navbar bottom border and rail right
          border leave off. Sits just below the navbar (top: 100%) so its transparent
          quadrant reveals the page background behind. */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: "100%",
          left: expanded ? EXPANDED_W : COLLAPSED_W,
          width: SEAM_R,
          height: SEAM_R,
          background: `radial-gradient(circle at bottom right, transparent ${SEAM_R - 0.5}px, var(--color-border-subtle) ${SEAM_R - 0.5}px, var(--color-border-subtle) ${SEAM_R + 0.5}px, #fff ${SEAM_R + 0.5}px)`,
          transition: "left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
        }}
      />
      <div className="h-full grid grid-cols-[auto_1fr_auto] items-center px-6 gap-6">
        {/* Left: community selector + community management cog. The selector's avatar
            is pulled left to sit directly ABOVE the sidebar rail's icon column: the
            rail centers a 40px icon at ICON_LEFT (17px) from the viewport edge, and the
            selector button's own px-3 (12px) + the grid's px-6 (24px) would otherwise
            land the avatar at 36px — so a -19px nudge aligns the two icon columns. */}
        <div className="flex items-center gap-3" style={{ marginLeft: -19 }}>
          <div data-tour="community-switcher">
            <CommunitySelector />
          </div>
          {canAccessAdmin && (
            <Link
              href="/admin"
              data-tour="community-console"
              aria-label="Community management"
              title="Community management"
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
                adminActive
                  ? "text-brand-green hover:text-brand-dark-green"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          )}
          {/* Docked-panel toggle — shown whenever the current page has a panel
              that docks into the sidebar (context tree, console sections). Lives
              up here so it never gets covered by the expanding sidebar card. */}
          {dockRequested && (
            <button
              type="button"
              onClick={() => setContextOpen(!contextOpen)}
              aria-label={contextOpen ? "Hide context" : "Show context"}
              title={contextOpen ? "Hide context" : "Show context"}
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                contextOpen
                  ? "text-brand-green hover:text-brand-dark-green"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
              </svg>
            </button>
          )}
        </div>

        {/* Center: page-injected content (search lives on the pages themselves) */}
        <div className="flex items-center justify-center w-full min-w-0">
          <div className="w-full max-w-2xl">
            {headerContent}
          </div>
        </div>

        {/* Right: page-injected controls (e.g. directory view toggle) + profile */}
        <div className="flex items-center gap-3">
          {headerRight}
          {/* Events live here, not in the sidebar rail: they're a shell-level
              surface (like Messages), always reachable and not a per-community
              tool, so public events from other communities stay discoverable. */}
          <Link
            href="/events?scope=discover"
            aria-label="Discover events"
            title="Discover events"
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
              eventsActive
                ? "text-brand-green hover:text-brand-dark-green"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </Link>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
