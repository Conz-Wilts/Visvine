"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCreateModal } from "@/lib/contexts/CreateModalContext";
import { useSidebar } from "@/lib/contexts/SidebarContext";
import { useContextPanel } from "@/lib/contexts/ContextPanelContext";
import { useCommunity } from "@/lib/contexts/CommunityContext";
import { visibleFeatures } from "@/lib/features";
import { shellEntranceStyle } from "@/lib/contexts/SidebarContext";
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

// Exported so the Navbar seam/fillet and the AuthLayout content padding track the
// exact same rail widths — change them here and the whole L-shell stays in sync.
export const COLLAPSED_W = 76;
export const EXPANDED_W = 212;
const ICON_SIZE = 40;
const ICON_LEFT = 17; // (COLLAPSED_W - 2px border - ICON_SIZE) / 2 — centers icon when collapsed
// Icon→label gap sized so the label's left edge lands at the rail's right edge:
// when collapsed the overflow-hidden container clips it away completely.
const LABEL_ML = COLLAPSED_W - ICON_LEFT - ICON_SIZE;
const ITEM_GAP = 4;
const ITEM_STEP = ICON_SIZE + ITEM_GAP;
const PANEL_W = 256; // /context tree panel width — keep in sync with NotesWorkspace
const CHANNELS_PANEL_W = 300; // /channels list panel width — keep in sync with MessagesClient
const ADMIN_PANEL_W = 260; // /admin console sections panel width — keep in sync with ConsoleShell
const DOCK_MIN_WIDTH = 1024; // below this the docked panel would crowd the content — keep the page's inline layout instead
const DOCKED_H = "calc(100dvh - 88px)"; // full docked height — from navbar bottom (64px) to a 24px gap above the viewport bottom
const RAIL_PAD_Y = 16; // paddingTop/paddingBottom on the rail column
const RAIL_GAP = 8; // gap between the Create block and the nav list

// Natural height of the collapsed icon rail (Create row + nav rows). Used as the
// concrete un-docked height so the floating card hugs its content instead of
// running full-height, and so the card can *transition* its height into the docked
// full height (CSS can't animate to/from `auto`/`h-full`). Seeds the initial render;
// railRef re-measures the real DOM on mount so this stays correct if the layout changes.
function railHeightFor(navCount: number): number {
  const rows = navCount + 1; // + the "More" grid row that lives inside the nav list
  const navH = rows * ICON_SIZE + Math.max(0, rows - 1) * ITEM_GAP;
  return RAIL_PAD_Y * 2 + ICON_SIZE /* Create row */ + RAIL_GAP + navH;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { open: openCreateModal } = useCreateModal();
  // `entered` + `reduced` are shared with the Navbar (SidebarContext) so the whole
  // navbar + rail shell plays one coordinated entrance on load.
  const { expanded, setExpanded, entered, reduced } = useSidebar();
  const { currentCommunity, isAdmin } = useCommunity();
  const { setHost } = useContextPanel();

  // Honour reduced-motion: collapse the width/height transitions below to 0s.
  const dur = reduced ? "0s" : "0.32s";
  const ease = "cubic-bezier(0.25, 0.1, 0.25, 1)";

  // Nav items come from the feature registry, filtered to the community's
  // enabled surfaces (empty config → everything on) and to what this user may
  // see (an admins-only directory is hidden from members). See lib/features.tsx.
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  // Messages lives in the top navbar (beside the profile icon), not the rail.
  const allNav = visibleFeatures(featureConfig, isAdmin).filter(({ key }) => key !== "messages");
  const activeIndex = allNav.findIndex(({ href }) => pathname === href);

  // On /context (always) and /channels (wide viewports only) the rail docks into a
  // full-height card hosting a side panel — the notes tree or the channel list. The
  // page then portals its panel content into the host below via ContextPanelContext.
  // Channels stays un-docked below DOCK_MIN_WIDTH so a 300px panel doesn't crowd the
  // thread on narrow screens (the page keeps its own inline list there instead).
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const dockedContext = pathname.startsWith("/context");
  const dockedChannels = pathname.startsWith("/channels") && wide;
  // The Community Console docks its section list here too (exact match so
  // /admin/resources keeps the plain floating rail).
  const dockedAdmin = pathname === "/admin" && wide;
  const docked = dockedContext || dockedChannels || dockedAdmin;
  const panelW = dockedChannels ? CHANNELS_PANEL_W : dockedAdmin ? ADMIN_PANEL_W : PANEL_W;

  // Un-docked height of the floating card: a concrete px value (not h-full) so the
  // card hugs its icon rail and can transition into the docked full height. Seed from
  // the layout math, then trust the measured DOM (re-measures when nav-item count
  // changes). Independent of the hover-expand — expanding widens, never heightens.
  const railRef = useRef<HTMLDivElement>(null);
  const [railHeight, setRailHeight] = useState(() => railHeightFor(allNav.length));
  useEffect(() => {
    const h = railRef.current?.offsetHeight ?? 0;
    if (h > 0) setRailHeight(h);
  }, [allNav.length]);

  // Shared with the Navbar: both drift in from the left by the same amount so the
  // whole L-shell flows into place as one piece (see shellEntranceStyle).
  const entranceStyle = shellEntranceStyle(entered, reduced);

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
          <span className="text-sm font-medium whitespace-nowrap" style={{ marginLeft: LABEL_ML, color: "var(--text-secondary, #374151)" }}>
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
                <span className="text-sm font-medium whitespace-nowrap" style={{ marginLeft: LABEL_ML }}>
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

        {/* "More" — 3x3 grid glyph. No functionality yet (static, non-interactive).
            Styled like a nav row with the same collapsed tooltip. */}
        <div className="relative group" data-tour="nav-more">
          <div
            className="relative z-10 flex items-center h-10 w-full"
            style={{ paddingLeft: ICON_LEFT, color: "var(--text-secondary, #374151)" }}
          >
            {/* Icon: fixed 40x40 cell, centered — 3x3 grid of 9 dots = "more" */}
            <span className="relative flex items-center justify-center shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }}>
              <svg className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="5" r="1.6" />
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="19" cy="5" r="1.6" />
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
                <circle cx="5" cy="19" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
                <circle cx="19" cy="19" r="1.6" />
              </svg>
            </span>
            <span className="text-sm font-medium whitespace-nowrap" style={{ marginLeft: LABEL_ML }}>
              More
            </span>
          </div>

          {!expanded && (
            <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
              style={{ left: COLLAPSED_W + 4 }}
            >
              More
            </span>
          )}
        </div>
      </nav>
    </>
  );

  // ONE <aside> for both modes, so it's the same persistent element across
  // navigation — identical placement (card top flush under the navbar at 64px =
  // top-16) and the same entrance animation, never re-mounting. The top edge and
  // top-right corner are squared off (no top border) so the rail reads as one
  // continuous L-shaped shell with the navbar. On /context the card just grows
  // full-height and gains the notes-tree column beside the rail; the page portals
  // its <NoteSidebar> into the host below.
  return (
    <aside
      className="fixed left-0 top-16 z-40"
      style={entranceStyle}
    >
      {/* The card's height is explicit (not h-full) so it can transition between the
          collapsed rail height and the docked full height when entering /context.
          Flush against the left screen edge: no left padding, and the left corners /
          border are dropped so it reads as attached to the side rather than floating. */}
      <div
        className="flex overflow-hidden rounded-l-none rounded-tr-none rounded-br-2xl border border-l-0 border-t-0 border-border-subtle bg-white"
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

        {/* The side panel, hosted inside this same card. Always mounted so the portal
            host stays stable and the column can transition its width open ↔ closed;
            off the docked routes it's a clipped 0-width sliver with an empty host. */}
        <div
          className="relative shrink-0 overflow-hidden"
          style={{ width: docked ? panelW : 0, transition: `width ${dur} ${ease}` }}
        >
          {/* Seam divider — faded out when closed so no stray hairline lingers off-dock */}
          <div
            className="absolute left-0 top-0 h-full w-px bg-border-default"
            style={{ opacity: docked ? 1 : 0, transition: `opacity ${dur} ${ease}` }}
          />
          {/* Portal host: the page (NotesWorkspace / MessagesClient) mounts its panel
              here. Inner width tracks the active route's panel so the content is
              revealed by the clipping column rather than reflowing as it opens. */}
          <div ref={setHost} className="h-full min-h-0" style={{ width: panelW }} />
        </div>
      </div>
    </aside>
  );
}
