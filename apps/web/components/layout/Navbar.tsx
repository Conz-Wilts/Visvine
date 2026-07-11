"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommunitySelector } from "@/features/communities";
import UserMenu from "@/components/auth/UserMenu";
import { useHeader } from "@/lib/contexts/HeaderContext";
import { useCommunity } from "@/lib/contexts/CommunityContext";
import { useSidebar, shellEntranceStyle } from "@/lib/contexts/SidebarContext";
import { useSession } from "@/lib/auth-client";
import { isFeatureEnabled } from "@/lib/features";
import { COLLAPSED_W, EXPANDED_W } from "@/features/shared/components/layout/Sidebar";
import type { CommunityFeatureConfig } from "@/lib/types";

const SEAM_R = 10; // radius of the concave fillet joining the navbar to the sidebar rail

export default function Navbar() {
  const { headerContent, headerRight } = useHeader();
  const { isAdmin, currentCommunity } = useCommunity();
  const { expanded, entered, reduced } = useSidebar();
  const { data: session } = useSession();
  const pathname = usePathname();
  const canAccessAdmin = isAdmin || session?.user?.isSuperAdmin === true;
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  const messagesEnabled = isFeatureEnabled(featureConfig, "messages");
  const messagesActive = pathname.startsWith("/messages");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!isAdmin || !currentCommunity) { setPendingCount(0); return; }
    let cancelled = false;
    fetch(`/api/communities/${currentCommunity.id}/submissions/count`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setPendingCount(d.count ?? 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin, currentCommunity]);

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
              className="relative w-12 h-12 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-2 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </Link>
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
          {messagesEnabled && (
            <Link
              href="/messages"
              aria-label="Messages"
              title="Messages"
              aria-current={messagesActive ? "page" : undefined}
              className={`w-12 h-12 rounded-xl flex items-center justify-center text-white transition-colors shrink-0 ${
                messagesActive ? "bg-brand-green" : "hover:bg-surface-2"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </Link>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
