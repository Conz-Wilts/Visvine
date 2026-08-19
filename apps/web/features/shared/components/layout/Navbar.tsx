"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SpaceSelector from "@/features/spaces/components/SpaceSelector";
import UserMenu from "@/features/auth/components/UserMenu";
import NotificationBell from "@/features/shared/components/layout/NotificationBell";
import { useHeader } from "@/features/shared/contexts/HeaderContext";
import { useSpace } from "@/features/shared/contexts/SpaceContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { useSession } from "@/features/auth/lib/auth-client";
import { canAccessFeature } from "@/features/shared/lib/features";
import type { SpaceFeatureConfig } from "@/lib/types";

export default function Navbar() {
  const { headerContent, headerRight } = useHeader();
  const { isAdmin, currentSpace } = useSpace();
  const { dockRequested, contextOpen, setContextOpen } = useContextPanel();
  const { data: session } = useSession();
  const pathname = usePathname();
  const eventsActive = pathname.startsWith("/events");
  const toolsActive = pathname.startsWith("/tools");
  const adminActive = pathname.startsWith("/admin");
  const canAccessAdmin = isAdmin || session?.user?.isSuperAdmin === true;
  // The marketplace is a member surface — installing is what's admin-gated, and
  // that happens inside. What does hide the icon is the space switching Tools
  // off (or locking the key to admins), the same `featureConfig` decision the
  // rail obeys; with no space chosen the catalogue is still browsable, since the
  // registry itself is global.
  const canAccessTools =
    !currentSpace ||
    canAccessFeature(
      (currentSpace.featureConfig as SpaceFeatureConfig | undefined) ?? null,
      "tools",
      isAdmin,
    );

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-16"
      style={{ background: "var(--shell-bg, #ffffff)" }}
    >
      <div className="h-full grid grid-cols-[auto_1fr_auto] items-center px-6 gap-6">
        {/* Left: space selector + space management cog. The selector's avatar
            is pulled left to sit directly ABOVE the sidebar rail's icon column: the
            rail centers a 40px icon at ICON_LEFT (17px) from the viewport edge, and the
            selector button's own px-3 (12px) + the grid's px-6 (24px) would otherwise
            land the avatar at 36px — so a -19px nudge aligns the two icon columns. */}
        <div className="flex items-center gap-3" style={{ marginLeft: -19 }}>
          <SpaceSelector />
          {canAccessAdmin && (
            <Link
              href="/admin"
              aria-label="Space management"
              title="Space management"
              className={`w-12 h-12 rounded-xl flex items-center justify-center shell-icon-btn ${
                adminActive ? "shell-icon-btn--active" : ""
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
              className={`w-12 h-12 rounded-xl flex items-center justify-center shell-icon-btn ${
                contextOpen ? "shell-icon-btn--active" : ""
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
              surface (like Messages), always reachable and not a per-space
              tool, so public events from other spaces stay discoverable. */}
          {/* With no space selected the space-scoped events page has nothing
              to show, so the calendar lands on the global discover grid instead. */}
          <Link
            href={currentSpace ? "/events?scope=discover" : "/events/discover"}
            aria-label="Discover events"
            title="Discover events"
            className={`w-12 h-12 rounded-xl flex items-center justify-center shell-icon-btn ${
              eventsActive ? "shell-icon-btn--active" : ""
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </Link>
          {/* Tools sit beside the calendar for the same reason: the marketplace
              is global — one shelf every space installs from — so it belongs in
              the shell chrome rather than in a per-space sidebar rail. (An
              INSTALLED tool does get a rail row; this is the shop, not a tool.) */}
          {canAccessTools && (
            <Link
              href="/tools"
              aria-label="Tools"
              title="Tools"
              className={`w-12 h-12 rounded-xl flex items-center justify-center shell-icon-btn ${
                toolsActive ? "shell-icon-btn--active" : ""
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="8" height="8" rx="1.5" />
                <rect x="13" y="3" width="8" height="8" rx="1.5" />
                <rect x="3" y="13" width="8" height="8" rx="1.5" />
                <path d="M17 13v8M13 17h8" />
              </svg>
            </Link>
          )}
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
