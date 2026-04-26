"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CommunitySelector } from "@/features/communities";
import UserMenu from "@/components/auth/UserMenu";
import ChatInterface from "@/components/chat/ChatInterface";
import { useHeader } from "@/lib/contexts/HeaderContext";
import { useCommunity } from "@/lib/contexts/CommunityContext";
import { useSession } from "@/lib/auth-client";

export default function Navbar() {
  const { headerContent } = useHeader();
  const { isAdmin, currentCommunity } = useCommunity();
  const { data: session } = useSession();
  const canAccessAdmin = isAdmin || session?.user?.isSuperAdmin === true;
  const headerRef = useRef<HTMLElement>(null);
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

  useEffect(() => {
    function onScroll() {
      const el = headerRef.current;
      if (!el) return;
      if (window.scrollY > 8) {
        el.style.boxShadow = '0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)';
      } else {
        el.style.boxShadow = 'none';
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 h-20 bg-brand-bg"
      style={{ transition: 'box-shadow 300ms ease' }}
    >
      <div className="h-full grid grid-cols-[auto_1fr_auto] items-center px-6 gap-6">
        {/* Left: logo + community selector */}
        <div className="flex items-center gap-4">
          <CommunitySelector />
          {canAccessAdmin && (
            <Link
              href="/admin"
              title="Community Management"
              className="relative w-12 h-12 flex items-center justify-center rounded-full bg-white border border-border-subtle text-text-secondary hover:bg-surface-2 transition shadow-sm"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </Link>
          )}
        </div>

        {/* Center: search bar — fills remaining space, shrinks on small screens */}
        <div className="flex items-center justify-center w-full min-w-0">
          <div className="w-full max-w-2xl">
            {headerContent ?? <ChatInterface placeholder="Search…" />}
          </div>
        </div>

        {/* Right: profile */}
        <div className="flex items-center">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
