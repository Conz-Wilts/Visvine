"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCreateModal } from "@/lib/contexts/CreateModalContext";
import { useSidebar } from "@/lib/contexts/SidebarContext";

const NAV = [
  {
    href: "/directory",
    label: "Directory",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: "/feed",
    label: "Feed",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
  },
  {
    href: "/events",
    label: "Events",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: "/resources",
    label: "Resources",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  {
    href: "/messages",
    label: "Messages",
    icon: (
      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
];

/*
 * Layout model (nothing changes on expanded toggle except container width):
 *
 *  Container: width transitions 64 ↔ 200, overflow-hidden clips labels
 *  ┌──────────────────────────────────┐
 *  │ 12px │ 40px icon │ 8px │ label… │  ← each row is fixed layout
 *  └──────────────────────────────────┘
 *
 *  Collapsed (64px): icon centered (12 + 40 + 12 = 64), label clipped
 *  Expanded (200px): icon same spot, label revealed
 *  Transition: ONLY container width animates. Zero instant flips.
 */

const COLLAPSED_W = 64;
const EXPANDED_W = 200;
const ICON_SIZE = 40;
const ICON_LEFT = 11; // (COLLAPSED_W - 2px border - ICON_SIZE) / 2 — centers icon when collapsed
const ITEM_GAP = 4;
const ITEM_STEP = ICON_SIZE + ITEM_GAP;

const hasAnimatedRef = { current: false };

export default function Sidebar() {
  const pathname = usePathname();
  const { open: openCreateModal } = useCreateModal();
  const { expanded, setExpanded } = useSidebar();
  const [entered, setEntered] = useState(hasAnimatedRef.current);
  // Introductions awaiting the viewer's action — intros live inside Messages now,
  // so the badge sits on the Messages nav item (was the old topbar IntrosBell).
  const [introCount, setIntroCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch('/api/intros/count');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIntroCount(data.count ?? 0);
      } catch { /* ignore */ }
    };
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (hasAnimatedRef.current) return;
    const t = setTimeout(() => {
      setEntered(true);
      hasAnimatedRef.current = true;
    }, 120);
    return () => clearTimeout(t);
  }, []);

  const allNav = NAV.filter((n) => n.href !== "/settings");
  const activeIndex = allNav.findIndex(({ href }) => pathname === href);

  return (
    <aside
      className="fixed left-0 top-20 z-40 pt-4 pl-6"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div
        className="flex flex-col bg-surface-1 rounded-2xl border border-border-default overflow-hidden shadow-float"
        style={{
          width: expanded ? EXPANDED_W : COLLAPSED_W,
          paddingTop: 16,
          paddingBottom: 16,
          gap: 8,
          transform: entered ? 'translateX(0)' : 'translateX(-60px)',
          opacity: entered ? 1 : 0,
          transition: 'width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease-out',
        }}
      >
        {/* Nav items */}
        <nav className="relative flex flex-col gap-1">
          {/* Green indicator — left/right: 12px, so 64-24=40px circle when collapsed, stretches when expanded */}
          {activeIndex >= 0 && (
            <div
              className="absolute rounded-full bg-brand-green shadow-md pointer-events-none"
              style={{
                height: ICON_SIZE,
                left: ICON_LEFT,
                right: ICON_LEFT,
                top: 0,
                transform: `translateY(${activeIndex * ITEM_STEP}px)`,
                transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          )}

          {allNav.map(({ href, label, icon }) => {
            const active = pathname === href;
            return (
              <div key={href} className="relative group">
                {/* Row: fixed left position, icon + label always in DOM */}
                <Link
                  href={href}
                  className="relative z-10 flex items-center h-10"
                  style={{
                    paddingLeft: ICON_LEFT,
                    color: active ? 'white' : 'var(--text-secondary, #374151)',
                    transition: 'color 0.3s',
                  }}
                >
                  {/* Icon: fixed 40x40 centered */}
                  <span className="relative flex items-center justify-center shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }}>
                    {icon}
                    {href === "/messages" && introCount > 0 && (
                      <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-brand-green text-brand-black text-[9px] font-bold ring-2 ring-surface-1">
                        {introCount > 99 ? '99+' : introCount}
                      </span>
                    )}
                  </span>
                  {/* Label: always present, clipped by container overflow-hidden when collapsed */}
                  <span className="text-sm font-medium whitespace-nowrap ml-3">
                    {label}
                  </span>
                </Link>

                {/* Tooltip only when collapsed */}
                {!expanded && (
                  <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
                    style={{ left: COLLAPSED_W + 4 }}
                  >
                    {label}
                  </span>
                )}
              </div>
            );
          })}
        </nav>

        {/* Create button */}
        <div className="relative group">
          <button
            onClick={() => openCreateModal()}
            className="flex items-center h-10 text-white"
            style={{ paddingLeft: ICON_LEFT }}
          >
            <span
              className="flex items-center justify-center shrink-0 rounded-full hover:scale-105 active:scale-95"
              style={{
                width: ICON_SIZE,
                height: ICON_SIZE,
                background: 'var(--color-brand-green, #78d870)',
                boxShadow: '0 4px 12px color-mix(in srgb, var(--color-brand-green, #78d870) 50%, transparent)',
                transition: 'transform 0.2s',
              }}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </span>
            <span className="text-sm font-medium whitespace-nowrap ml-3" style={{ color: 'var(--text-secondary, #374151)' }}>
              Create new
            </span>
          </button>

          {!expanded && (
            <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
              style={{ left: COLLAPSED_W + 4 }}
            >
              Create new
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
