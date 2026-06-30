"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCreateModal } from "@/lib/contexts/CreateModalContext";
import { useSidebar } from "@/lib/contexts/SidebarContext";
import { useContextPanel } from "@/lib/contexts/ContextPanelContext";
import { useCommunity } from "@/lib/contexts/CommunityContext";
import { enabledFeatures } from "@/lib/features";
import { prefersReducedMotion } from "@/lib/motion";
import type { CommunityFeatureConfig } from "@/lib/types";

/*
 * Layout model (nothing changes on expanded toggle except container width):
 *
 *  Container: width transitions 64 ↔ 200, overflow-hidden clips labels
 *  ┌──────────────────────────────────┐
 *  │ 11px │ 40px icon │ 12px │ label… │  ← each row is fixed layout
 *  └──────────────────────────────────┘
 *
 *  Collapsed (64px): icon centered, label clipped
 *  Expanded (200px): icon same spot, label revealed
 *  Transition: ONLY container width animates. Zero instant flips.
 *
 * On /context the rail extends into a full-height card that ALSO hosts the notes
 * tree (the page portals its tree into the host div below via ContextPanelContext),
 * so the icon rail + tree read as one connected container. Everywhere else it's
 * just the floating icon rail.
 */

const COLLAPSED_W = 64;
const EXPANDED_W = 200;
const ICON_SIZE = 40;
const ICON_LEFT = 11; // (COLLAPSED_W - 2px border - ICON_SIZE) / 2 — centers icon when collapsed
const ITEM_GAP = 4;
const ITEM_STEP = ICON_SIZE + ITEM_GAP;
const PANEL_W = 256; // /context tree panel width — keep in sync with NotesWorkspace
const DOCKED_H = "calc(100dvh - 120px)"; // full docked height — mirrors NotesWorkspace's content area
const RAIL_PAD_Y = 16; // paddingTop/paddingBottom on the rail column
const RAIL_GAP = 8; // gap between the Create block and the nav list

// Natural height of the collapsed icon rail (Create row + nav rows). Used as the
// concrete start height so the docked card can *transition* its height — CSS can't
// animate to/from `auto`/`h-full`. Seeds the initial render; railRef re-measures
// the real DOM on mount so this stays correct if the rail layout ever changes.
function railHeightFor(navCount: number): number {
  const navH = navCount * ICON_SIZE + Math.max(0, navCount - 1) * ITEM_GAP;
  return RAIL_PAD_Y * 2 + ICON_SIZE /* Create row */ + RAIL_GAP + navH;
}

const hasAnimatedRef = { current: false };

export default function Sidebar() {
  const pathname = usePathname();
  const { open: openCreateModal } = useCreateModal();
  const { expanded, setExpanded } = useSidebar();
  const { currentCommunity } = useCommunity();
  const { setHost } = useContextPanel();
  const [entered, setEntered] = useState(hasAnimatedRef.current);
  const railRef = useRef<HTMLDivElement>(null);

  // Honour reduced-motion: collapse every transition below to 0s. Read on mount
  // (client-only) to stay SSR-safe.
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(prefersReducedMotion()), []);
  const dur = reduced ? "0s" : "0.32s";
  const ease = "cubic-bezier(0.25, 0.1, 0.25, 1)";

  useEffect(() => {
    if (hasAnimatedRef.current) return;
    const t = setTimeout(() => {
      setEntered(true);
      hasAnimatedRef.current = true;
    }, 120);
    return () => clearTimeout(t);
  }, []);

  // Nav items come from the feature registry, filtered to the community's
  // enabled surfaces (empty config → everything on). See lib/features.tsx.
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  const allNav = enabledFeatures(featureConfig);
  const activeIndex = allNav.findIndex(({ href }) => pathname === href);

  // On /context the rail docks into a full-height card hosting the notes tree.
  const docked = pathname.startsWith("/context");

  // Collapsed rail height as a concrete px value so the docked card can transition
  // its height. Seed from the layout math, then trust the measured DOM (re-measures
  // when the nav-item count changes). Rail height is independent of the hover-expand.
  const [railHeight, setRailHeight] = useState(() => railHeightFor(allNav.length));
  useEffect(() => {
    const h = railRef.current?.offsetHeight ?? 0;
    if (h > 0) setRailHeight(h);
  }, [allNav.length]);

  const entranceStyle = {
    transform: entered ? "translateX(0)" : "translateX(-60px)",
    opacity: entered ? 1 : 0,
    transition:
      "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease-out",
  };

  // The icon rail's inner content — reused by both the floating and docked cards.
  const railInner = (
    <>
      {/* Create button */}
      <div className="relative group" data-tour="create">
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
              background: "var(--color-brand-green, #78d870)",
              boxShadow: "0 4px 12px color-mix(in srgb, var(--color-brand-green, #78d870) 50%, transparent)",
              transition: "transform 0.2s",
            }}
          >
            <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </span>
          <span className="text-sm font-medium whitespace-nowrap ml-3" style={{ color: "var(--text-secondary, #374151)" }}>
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

      {/* Nav items */}
      <nav className="relative flex flex-col gap-1">
        {/* Green indicator — left/right: ICON_LEFT, so a 40px pill when collapsed,
            stretches when expanded */}
        {activeIndex >= 0 && (
          <div
            className="absolute rounded-full bg-brand-green shadow-md pointer-events-none"
            style={{
              height: ICON_SIZE,
              left: ICON_LEFT,
              right: ICON_LEFT,
              top: 0,
              transform: `translateY(${activeIndex * ITEM_STEP}px)`,
              transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          />
        )}

        {allNav.map(({ key, href, label, icon }) => {
          const active = pathname === href;
          return (
            <div key={href} data-tour={`nav-${key}`} className="relative group">
              <Link
                href={href}
                className="relative z-10 flex items-center h-10"
                style={{
                  paddingLeft: ICON_LEFT,
                  color: active ? "white" : "var(--text-secondary, #374151)",
                  transition: "color 0.3s",
                }}
              >
                {/* Icon: fixed 40x40 cell, centered */}
                <span className="relative flex items-center justify-center shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }}>
                  {icon}
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
    </>
  );

  // ONE <aside> for both modes, so it's the same persistent element across
  // navigation — identical placement (card top at 96px = top-20 + pt-4) and the
  // same entrance animation, never re-mounting. On /context the card just grows
  // full-height and gains the notes-tree column beside the rail; the page portals
  // its <NoteSidebar> into the host below.
  return (
    <aside
      className="fixed left-0 top-20 z-40 pt-4 pl-6"
      style={entranceStyle}
    >
      {/* The card's height is explicit (not h-full) so it can transition between the
          collapsed rail height and the docked full height when entering /context. */}
      <div
        className="flex overflow-hidden rounded-2xl border border-border-default bg-surface-1 shadow-float"
        style={{
          height: docked ? DOCKED_H : railHeight,
          transition: `height ${dur} ${ease}`,
        }}
      >
        {/* Icon rail column — hover-expands; the only width that animates. Hover
            lives here (not the aside) so hovering the tree never expands the rail.
            self-start keeps it at its natural height instead of stretching to fill
            the docked card, so railRef always measures the true collapsed height
            (the card's bg/border still spans full height when docked). */}
        <div
          ref={railRef}
          className="relative flex shrink-0 flex-col overflow-hidden self-start"
          style={{
            width: expanded ? EXPANDED_W : COLLAPSED_W,
            paddingTop: RAIL_PAD_Y,
            paddingBottom: RAIL_PAD_Y,
            gap: RAIL_GAP,
            transition: "width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
          }}
          onMouseEnter={() => setExpanded(true)}
          onMouseLeave={() => setExpanded(false)}
        >
          {railInner}
        </div>

        {/* The notes tree, hosted inside this same card. Always mounted so the portal
            host stays stable and the column can transition its width open ↔ closed;
            off /context it's a clipped 0-width sliver with an empty host. */}
        <div
          className="relative shrink-0 overflow-hidden"
          style={{ width: docked ? PANEL_W : 0, transition: `width ${dur} ${ease}` }}
        >
          {/* Seam divider — faded out when closed so no stray hairline lingers off /context */}
          <div
            className="absolute left-0 top-0 h-full w-px bg-border-default"
            style={{ opacity: docked ? 1 : 0, transition: `opacity ${dur} ${ease}` }}
          />
          {/* Portal host: NotesWorkspace mounts the tree here. Fixed inner width so the
              tree is revealed by the clipping column rather than reflowing as it opens. */}
          <div ref={setHost} className="h-full min-h-0" style={{ width: PANEL_W }} />
        </div>
      </div>
    </aside>
  );
}
