"use client";

import { useEffect, useState } from "react";
import { CommunitySelector } from "@/features/communities";
import UserMenu from "@/components/auth/UserMenu";
import ChatInterface from "@/components/chat/ChatInterface";
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
    <header className="fixed top-0 left-0 right-0 z-50 h-20 bg-white">
      <div className="h-full grid grid-cols-[auto_1fr_auto] items-center px-6 gap-6">
        {/* Left: logo + community selector (community management lives in its dropdown) */}
        <div className="flex items-center gap-4">
          <CommunitySelector canManage={canAccessAdmin} pendingCount={pendingCount} />
        </div>

        {/* Center: search bar — fills remaining space, shrinks on small screens */}
        <div className="flex items-center justify-center w-full min-w-0">
          <div className="w-full max-w-2xl">
            {headerContent ?? <ChatInterface placeholder="Search…" />}
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
