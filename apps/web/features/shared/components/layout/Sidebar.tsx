"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCreateModal, useCreateSurface, type CreateableType } from "@/lib/contexts/CreateModalContext";
import { useSidebar } from "@/lib/contexts/SidebarContext";
import { useContextPanel } from "@/lib/contexts/ContextPanelContext";
import { useCommunity } from "@/lib/contexts/CommunityContext";
import { railFeatures, moreFeatures } from "@/lib/features";
import { shellEntranceStyle, DOCK_MS, DOCK_EASE } from "@/lib/contexts/SidebarContext";
import Modal from "@/components/ui/Modal";
import CreateModal from "@/components/create/CreateModal";
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
 * The card always spans navbar → viewport bottom. While the /context page or a
 * profile's Context tab is active it ALSO hosts the notes tree (the embedded
 * workspace requests the dock and portals its tree into the host div below via
 * ContextPanelContext), so the icon rail + tree read as one connected container.
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
const CHANNELS_PANEL_W = 300; // /channels + /messages list panel width — keep in sync with MessagesClient
const ADMIN_PANEL_W = 260; // /admin console sections panel width — keep in sync with ConsoleShell
export const CONTEXT_PANEL_W = 300; // /context notes tree panel — keep in sync with the context page inset
export const DOCK_MIN_WIDTH = 1024; // below this the docked panel would crowd the content — keep the page's inline layout instead
const RAIL_H = "calc(100dvh - 64px)"; // rail card always runs from the navbar bottom to the viewport bottom
const RAIL_PAD_Y = 16; // paddingTop/paddingBottom on the rail column
const RAIL_GAP = 8; // gap between the Create block and the nav list

// The things the docked Create panel still makes. Everything else is a context
// note, so it opens the note-first draft surface instead (see useCreateSurface).
const CREATE_PANEL_TYPES: Array<{ type: CreateableType; label: string }> = [
  { type: "file", label: "Upload a file" },
  { type: "channel", label: "Channel" },
  { type: "space", label: "Space" },
  { type: "community", label: "Community" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { isOpen: createOpen } = useCreateModal();
  const createSurface = useCreateSurface();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  // `entered` + `reduced` are shared with the Navbar (SidebarContext) so the whole
  // navbar + rail shell plays one coordinated entrance on load.
  const { expanded, setExpanded, entered, reduced } = useSidebar();
  const { currentCommunity, isAdmin } = useCommunity();
  const { setHost, dockRequested, contextOpen, dockTopInset } = useContextPanel();

  // Honour reduced-motion: collapse the width/height transitions below to 0s.
  const dur = reduced ? "0s" : `${DOCK_MS}ms`;
  const ease = DOCK_EASE;

  // Nav items come from the feature registry, filtered to the community's
  // enabled surfaces (empty config → everything on) and to what this user may
  // see (an admins-only directory is hidden from members), then split between
  // the rail and the "More" popup per featureConfig.more. See lib/features.tsx.
  // (Messages lives in the top navbar — toggleable but nav-less.)
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  const allNav = railFeatures(featureConfig, isAdmin);
  const moreNav = moreFeatures(featureConfig, isAdmin);
  const moreActive = moreNav.some(({ href }) => pathname === href);
  const railActiveIndex = allNav.findIndex(({ href }) => pathname === href);
  // A More tool being active parks the pill on the More row — the last nav slot.
  const activeIndex = railActiveIndex >= 0 ? railActiveIndex : moreActive ? allNav.length : -1;

  // "More" popup: a centered modal (same shell as the Create-new modal) with a
  // grid of the tucked-away tools. Modal handles Escape + backdrop dismissal.
  const [moreOpen, setMoreOpen] = useState(false);
  // Close on navigation (a tool card was clicked, or back/forward).
  useEffect(() => setMoreOpen(false), [pathname]);

  // The create caret menu closes on navigation and on any click outside it —
  // including the "+" itself, whose own handler closes it before navigating.
  useEffect(() => setCreateMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!createMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    // Deferred to the next frame: the click that opened the menu is still
    // propagating, and would otherwise close it immediately.
    const id = requestAnimationFrame(() => document.addEventListener("mousedown", handler));
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [createMenuOpen]);

  // On /channels, /messages and /admin (wide viewports only) the rail docks
  // into a full-height card hosting a side panel — the channel/conversation
  // list or the console sections. The page then portals its content via
  // ContextPanelContext. Channels stays un-docked below DOCK_MIN_WIDTH so a
  // 300px panel doesn't crowd the thread on narrow screens (the page keeps its
  // own inline list there instead).
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  // Channels honours the navbar's panel toggle (open by default) — the page
  // raises dockRequested so the toggle shows, and closing hides the list.
  const dockedChannels = pathname.startsWith("/channels") && wide && contextOpen;
  // Messages docks its conversation list the same way — the inbox reads as an
  // attached sidebar rather than a floating card in the content area.
  const dockedMessages = pathname.startsWith("/messages") && wide;
  // The Community Console docks its section list here too (exact match so
  // /admin/resources keeps the plain floating rail).
  const dockedAdmin = pathname === "/admin" && wide;
  // Settings docks its section list the same way as the Console.
  const dockedSettings = pathname.startsWith("/settings") && wide;
  // The /context page and profile Context tabs raise dockRequested (already
  // wide-gated by the requesting page) when the tree is available; the panel
  // only opens once the user asks for it (contextOpen).
  const dockedContext = dockRequested && contextOpen && wide;
  const docked = dockedChannels || dockedMessages || dockedAdmin || dockedSettings || dockedContext;
  const panelW = dockedAdmin || dockedSettings ? ADMIN_PANEL_W : dockedContext ? CONTEXT_PANEL_W : CHANNELS_PANEL_W;

  // "Create new" takes over this same column: it replaces whatever panel is
  // docked (so the width never changes on open), and off-dock it pushes the
  // column open at the standard panel width — clamped so it can't outgrow a
  // narrow viewport, where nothing is docked anyway.
  const createW = docked ? `${panelW}px` : `min(${CHANNELS_PANEL_W}px, calc(100vw - ${COLLAPSED_W}px))`;
  const columnW = createOpen ? createW : docked ? `${panelW}px` : "0px";

  // Shared with the Navbar: both drift in from the left by the same amount so the
  // whole L-shell flows into place as one piece (see shellEntranceStyle).
  const entranceStyle = shellEntranceStyle(entered, reduced);

  // The icon rail's inner content — reused by both the floating and docked cards.
  const railInner = (
    <>
      {/* Create button */}
      <div className="relative group" data-tour="create">
        <button
          onClick={() => {
            setCreateMenuOpen(false);
            createSurface();
          }}
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

        {/* The caret is the escape hatch for the four things that are NOT context
            notes (a channel, space, community or uploaded file has no note to
            open), so they keep the docked panel. Everything else is one click
            away on the blank draft — no tile grid standing between "+" and a
            surface you can type into. */}
        {expanded && (
          <button
            type="button"
            aria-label="More things to create"
            aria-expanded={createMenuOpen}
            onClick={() => setCreateMenuOpen((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted transition hover:bg-black/5 hover:text-text-secondary"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}

        {createMenuOpen && (
          <div
            ref={createMenuRef}
            className="absolute left-2 right-2 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border-default bg-surface-1 py-1 shadow-lg"
          >
            {CREATE_PANEL_TYPES.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => {
                  setCreateMenuOpen(false);
                  createSurface(item.type);
                }}
                className="block w-full px-3 py-1.5 text-left text-[13px] text-text-primary transition hover:bg-surface-2"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

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

        {/* "More" — 3x3 grid glyph. Opens a flyout listing the tools the
            community tucked out of the rail (featureConfig.more). Hidden when
            nothing is tucked away. Sits in the same gap-1 column as the nav
            rows, so the active pill's translateY math covers it too. */}
        {moreNav.length > 0 && (
          <div className="relative group" data-tour="nav-more">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className="relative z-10 flex items-center h-10 w-full"
              style={{
                paddingLeft: ICON_LEFT,
                color: moreActive ? "white" : "var(--text-secondary, #374151)",
                transition: "color 0.3s",
              }}
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
            </button>

            {!expanded && !moreOpen && (
              <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
                style={{ left: COLLAPSED_W + 4 }}
              >
                More
              </span>
            )}
          </div>
        )}
      </nav>
    </>
  );

  // ONE <aside> for both modes, so it's the same persistent element across
  // navigation — identical placement (card top flush under the navbar at 64px =
  // top-16) and the same entrance animation, never re-mounting. The top edge and
  // top-right corner are squared off (no top border) so the rail reads as one
  // continuous L-shaped shell with the navbar. On the docked routes the card
  // gains a panel column beside the rail; the page portals its panel content
  // into the host below.
  return (
    <aside
      className="fixed left-0 top-16 z-40"
      style={entranceStyle}
    >
      {/* The card always runs from the navbar to the bottom of the viewport, flush
          against the left/bottom screen edges: those corners and borders are dropped
          so it reads as attached to the shell rather than floating. */}
      <div
        className="flex overflow-hidden border-r border-border-subtle bg-white"
        style={{ height: RAIL_H }}
      >
        {/* Icon rail column — hover-expands; the only width that animates. Hover
            lives here (not the aside) so hovering the tree never expands the rail. */}
        <div
          className="relative flex shrink-0 flex-col overflow-hidden"
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
            off the docked routes it's a clipped 0-width sliver with an empty host.
            "Create new" opens the same column and slides in over the host below. */}
        <div
          className="relative shrink-0 overflow-hidden"
          style={{ width: columnW, transition: `width ${dur} ${ease}` }}
        >
          {/* Seam divider — faded out when closed so no stray hairline lingers off-dock */}
          <div
            className="absolute left-0 top-0 z-20 h-full w-px bg-border-default"
            style={{ opacity: docked || createOpen ? 1 : 0, transition: `opacity ${dur} ${ease}` }}
          />
          {/* Portal host: the page (MessagesClient / ConsoleShell) mounts its panel
              here. Inner width tracks the active route's panel so the content is
              revealed by the clipping column rather than reflowing as it opens.
              paddingTop lets a page with a bar pinned at the card top (the
              Directory tabs) start its tree BELOW that bar instead of behind it —
              the raised-z bar then draws over this empty strip. */}
          <div
            ref={setHost}
            className="min-h-0"
            // paddingTop is animated: moving between docked surfaces with
            // different top bars (the context canvas has none, a note view has a
            // 96px tab bar) would otherwise teleport the tree up or down mid
            // navigation. Same duration/easing as the column, so the two read as
            // one motion.
            style={{
              width: panelW,
              height: '100%',
              paddingTop: dockedContext ? dockTopInset : 0,
              transition: `padding-top ${dur} ${ease}`,
            }}
          />

          {/* "Create new" — a layer over the host, clipped by this column so it
              slides out from under the icon rail and covers whatever panel is
              docked. Starts below any bar the page pins at the card top
              (dockTopInset — those bars outrank this card at z-[45]), so its
              header is never cut in half by one. */}
          {/* pointer-events-none while parked: the box still covers the docked
              panel (it's absolutely positioned over it) even with the panel
              slid out of view, so leaving it hit-testable made it swallow every
              wheel/click aimed at the docked tree — scrolling over the context
              tree did nothing while the graph behind it took the wheel. The
              panel re-enables events on itself once open. */}
          <div
            className={`absolute left-0 bottom-0 z-10 overflow-hidden ${createOpen ? '' : 'pointer-events-none'}`}
            // Fixed at the panel's FINAL width, not the column's animating one:
            // the slide is a translateX(-100%) of this box, so a width that grows
            // during the transition would keep moving the parked position and the
            // panel would trail the column's leading edge.
            style={{ top: dockTopInset, width: createW }}
          >
            <CreateModal />
          </div>
        </div>
      </div>

      {/* "More" popup — the same centered modal shell as the Create-new modal,
          with a grid of the tools tucked out of the rail. Portalled to <body>:
          the aside's entrance transform would otherwise trap the modal's
          fixed-position overlay inside the rail. */}
      {moreOpen &&
        createPortal(
        <Modal
          onClose={() => setMoreOpen(false)}
          ariaLabel="More tools"
          overlayClassName="items-center justify-center p-4"
          overlayStyle={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          maxWidth="max-w-sm"
          panelClassName="relative rounded-2xl border border-border-subtle bg-surface-1 shadow-2xl"
          panelStyle={{ animation: "moreModalIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          {/* Header — mirrors the Create-new modal's centered title + close */}
          <div className="relative flex items-center justify-center px-6 pt-6 pb-4 border-b border-border-subtle">
            <h2 className="font-semibold text-text-primary text-base">More tools</h2>
            <button
              onClick={() => setMoreOpen(false)}
              aria-label="Close"
              className="absolute right-6 w-8 h-8 rounded-full flex items-center justify-center bg-red-400 hover:scale-110 transition-transform"
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tool grid — same card layout as the Create-new type selector */}
          <div className="px-6 py-5">
            <div className="grid grid-cols-2 gap-3">
              {moreNav.map(({ key, href, label, icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    data-tour={`nav-more-${key}`}
                    className={`aspect-square flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 text-center overflow-hidden transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] ${
                      active
                        ? "border-brand-green bg-brand-green/10 text-brand-green"
                        : "border-border-subtle bg-surface-2/40 text-text-secondary hover:border-border-default"
                    }`}
                  >
                    {icon}
                    <span className="font-semibold text-sm text-text-primary">{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <style>{`
            @keyframes moreModalIn {
              from { opacity: 0; transform: scale(0.94) translateY(8px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>
        </Modal>,
        document.body,
      )}
    </aside>
  );
}
