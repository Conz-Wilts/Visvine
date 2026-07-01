"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CommunitySelector } from "@/features/communities";
import UserMenu from "@/components/auth/UserMenu";
import { useHeader } from "@/lib/contexts/HeaderContext";
import { useCommunity } from "@/lib/contexts/CommunityContext";
import { useSession } from "@/lib/auth-client";

export default function Navbar() {
  const { headerContent, headerRight } = useHeader();
  const { isAdmin, currentCommunity } = useCommunity();
  const { data: session } = useSession();
  const canAccessAdmin = isAdmin || session?.user?.isSuperAdmin === true;
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
    <header className="fixed top-0 left-0 right-0 z-50 h-20 bg-surface-1/80 backdrop-blur-md">
      <div className="h-full grid grid-cols-[auto_1fr_auto] items-center px-6 gap-6">
        {/* Left: logo + community selector + community management cog */}
        <div className="flex items-center gap-3">
          <div data-tour="community-switcher">
            <CommunitySelector />
          </div>
          {canAccessAdmin && (
            <Link
              href="/admin"
              data-tour="community-console"
              aria-label="Community management"
              title="Community management"
              className="relative w-12 h-12 rounded-xl flex items-center justify-center border border-border-default bg-surface-1 text-text-secondary hover:text-text-primary hover:bg-surface-2 transition shadow-float"
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
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
