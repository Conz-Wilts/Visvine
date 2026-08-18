"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCreateModal, useCreateSurface } from "@/features/shared/contexts/CreateModalContext";
import { useSidebar } from "@/features/shared/contexts/SidebarContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { useSpace } from "@/features/shared/contexts/SpaceContext";
import { SHELL_FRAME_GAP, SHELL_FRAME_MARGIN, SHELL_FRAME_RADIUS } from "@/features/shared/contexts/ThemeContext";
import { railFeatures, moreFeatures } from "@/features/shared/lib/features";
import { DOCK_MS, DOCK_CLOSE_MS, DOCK_EASE } from "@/features/shared/contexts/SidebarContext";
import Modal from "@/components/ui/Modal";
import CreateModal from "@/features/create/components/CreateModal";
import type { SpaceFeatureConfig } from "@/lib/types";

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

// Exported so the AuthLayout's frame box and the rail track the exact same
// widths — change them here and the whole shell stays in sync.
export const COLLAPSED_W = 76;
export const EXPANDED_W = 212;
const ICON_SIZE = 40;
const ICON_LEFT = 17; // (COLLAPSED_W - 2px border - ICON_SIZE) / 2 — centers icon when collapsed
// Icon→label gap sized so the label's left edge lands at the rail's right edge:
// when collapsed the overflow-hidden container clips it away completely.
const LABEL_ML = COLLAPSED_W - ICON_LEFT - ICON_SIZE;
const ITEM_GAP = 4;
const ITEM_STEP = ICON_SIZE + ITEM_GAP;
const CHANNELS_PANEL_W = 300; // /channels list panel width — keep in sync with MessagesClient
export const CONTEXT_PANEL_W = 300; // /context notes tree panel — keep in sync with the context page inset
const DOCK_MIN_WIDTH = 1024; // below this the docked panel would crowd the content — keep the page's inline layout instead
const RAIL_H = "calc(100dvh - 64px)"; // rail card always runs from the navbar bottom to the viewport bottom
const RAIL_PAD_Y = 16; // paddingTop/paddingBottom on the rail column
const RAIL_GAP = 8; // gap between the Create block and the nav list

export default function Sidebar() {
  const pathname = usePathname();
  const { isOpen: createOpen } = useCreateModal();
  const createSurface = useCreateSurface();
  const { expanded, setExpanded, reduced } = useSidebar();
  const { currentSpace, isAdmin, loading: spaceLoading } = useSpace();
  const { setHost, dockRequested, contextOpen, dockTopInset } = useContextPanel();

  const ease = DOCK_EASE;

  // Nav items come from the feature registry, filtered to the space's
  // enabled surfaces (empty config → everything on) and to what this user may
  // see (an admins-only directory is hidden from members), then split between
  // the rail and the "More" popup per featureConfig.more. See features/shared/lib/features.tsx.
  const featureConfig = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null;
  // The space's installed Tools ride the space DTO (lib/spaces/queries.ts), so
  // each one's rail row is built from the same data the rest of the nav is —
  // no fetch, no second loading state.
  const installedTools = currentSpace?.installedTools;
  // No space selected (and not merely still loading one): the tools and the
  // Create button all act on the current space, so none of them belong on the
  // rail. The empty rail card stays — the L-shell and the content inset are
  // sized around it. During the initial load the tools render as usual so the
  // rail doesn't flash empty on every page load.
  const noSpace = !spaceLoading && !currentSpace;
  const allNav = noSpace ? [] : railFeatures(featureConfig, isAdmin, installedTools);
  const moreNav = noSpace ? [] : moreFeatures(featureConfig, isAdmin, installedTools);
  // An install whose requirements this space doesn't meet still runs, with the
  // unsatisfied parts returning nothing — so its row gets a dot rather than
  // disappearing. Keyed by href because that is what a FeatureDef carries
  // through to the row; a Tool's is `/t/<slug>`, which no built-in can collide with.
  const degradedHrefs = new Set(
    (installedTools ?? []).filter((tool) => tool.degraded).map((tool) => tool.href),
  );
  // A tool stays lit on its sub-routes too (e.g. /channels redirects straight
  // to /channels/<conversationId>, which used to drop the pill right after the
  // click). Longest matching href wins so /directory/note/index.md beats /directory.
  const activeHref = [...allNav, ...moreNav]
    .filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
    .reduce<string | null>((best, { href }) => (href.length > (best?.length ?? -1) ? href : best), null);
  const moreActive = moreNav.some(({ href }) => href === activeHref);
  const railActiveIndex = allNav.findIndex(({ href }) => href === activeHref);
  // A More tool being active parks the pill on the More row — the last nav slot.
  const activeIndex = railActiveIndex >= 0 ? railActiveIndex : moreActive ? allNav.length : -1;

  // "More" popup: a centered modal (same shell as the Create-new modal) with a
  // grid of the tucked-away tools. Modal handles Escape + backdrop dismissal.
  const [moreOpen, setMoreOpen] = useState(false);
  // Close on navigation (a tool card was clicked, or back/forward).
  useEffect(() => setMoreOpen(false), [pathname]);

  // On /channels (wide viewports only) the rail docks into a full-height card
  // hosting a side panel — the channel list, or the notes tree on Context
  // surfaces. The page then portals its content via ContextPanelContext.
  // Channels stays un-docked below DOCK_MIN_WIDTH so a 300px panel doesn't
  // crowd the thread on narrow screens (the page keeps its own inline list
  // there instead).
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
  // The Space Console and personal Settings both used to dock their section
  // lists here; they now carry a pane-top tab bar instead (see ConsoleShell),
  // so /admin and /settings get the plain rail.
  // The /context page and profile Context tabs raise dockRequested (already
  // wide-gated by the requesting page) when the tree is available; the panel
  // only opens once the user asks for it (contextOpen).
  const dockedContext = dockRequested && contextOpen && wide;
  const docked = dockedChannels || dockedContext;
  const panelW = dockedContext ? CONTEXT_PANEL_W : CHANNELS_PANEL_W;

  // "Create new" takes over this same column: it replaces whatever panel is
  // docked (so the width never changes on open), and off-dock it pushes the
  // column open at the standard panel width — clamped so it can't outgrow a
  // narrow viewport, where nothing is docked anyway.
  const createW = docked ? `${panelW}px` : `min(${CHANNELS_PANEL_W}px, calc(100vw - ${COLLAPSED_W}px))`;
  const columnW = createOpen ? createW : docked ? `${panelW}px` : "0px";

  // Honour reduced-motion: collapse the width/margin transitions below to 0s.
  // Closing (nothing docked, no create panel) runs faster than opening — the
  // leaving panel should be out of the way before the destination's content
  // (the grid's card cascade) is mid-animation beside it.
  const dur = reduced ? "0s" : `${docked || createOpen ? DOCK_MS : DOCK_CLOSE_MS}ms`;

  // The icon rail's inner content — reused by both the floating and docked cards.
  const railInner = (
    <>
      {/* Create button — creates things INSIDE the current space, so it goes
          with the tools when no space is selected (creating a space itself
          lives on the switcher, not here). */}
      {!noSpace && <div className="relative group">
        <button
          onClick={() => createSurface()}
          className="flex items-center h-10"
          style={{ paddingLeft: ICON_LEFT }}
        >
          <span
            className="flex items-center justify-center shrink-0 rounded-full hover:scale-105 active:scale-95"
            style={{
              width: ICON_SIZE,
              height: ICON_SIZE,
              color: "var(--shell-create-fg, white)",
              background: "var(--shell-create-bg, var(--color-brand-green, #78d870))",
              boxShadow: "0 4px 12px color-mix(in srgb, var(--color-brand-green, #78d870) 50%, transparent)",
              transition: "transform 0.2s",
            }}
          >
            <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </span>
          <span className="text-sm font-medium whitespace-nowrap" style={{ marginLeft: LABEL_ML, color: "var(--shell-fg, #374151)" }}>
            Create new
          </span>
        </button>

        {/* No menu hangs off this button. Every type — including a channel,
            space, space, connector or uploaded file — is a choice in the
            draft surface's own Type row, so "+" is one click to a surface you
            can type into rather than a list of decisions. */}
        {!expanded && (
          <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
            style={{ left: COLLAPSED_W + 4 }}
          >
            Create new
          </span>
        )}
      </div>}

      {/* Nav items */}
      <nav className="relative flex flex-col gap-1">
        {/* Green indicator — left/right: ICON_LEFT, so a 40px pill when collapsed,
            stretches when expanded */}
        {activeIndex >= 0 && (
          <div
            className="absolute rounded-full shadow-md pointer-events-none"
            style={{
              background: "var(--shell-pill, var(--color-brand-green, #78d870))",
              height: ICON_SIZE,
              left: ICON_LEFT,
              right: ICON_LEFT,
              top: 0,
              transform: `translateY(${activeIndex * ITEM_STEP}px)`,
              transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          />
        )}

        {allNav.map(({ href, label, icon }) => {
          const active = href === activeHref;
          return (
            <div key={href} className="relative group">
              <Link
                href={href}
                className="relative z-10 flex items-center h-10"
                style={{
                  paddingLeft: ICON_LEFT,
                  color: active ? "var(--shell-pill-fg, white)" : "var(--shell-fg, #374151)",
                  transition: "color 0.3s",
                }}
              >
                {/* Icon: fixed 40x40 cell, centered */}
                <span className="relative flex items-center justify-center shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }}>
                  {icon}
                  {/* Degraded install marker. Ringed in the rail's own
                      background so it reads as a badge on the icon rather than
                      part of the glyph, and it sits inside the icon cell so it
                      travels with the row whether the rail is collapsed or open. */}
                  {degradedHrefs.has(href) && (
                    <span
                      title={`${label} is missing something it needs in this space — it runs with those parts switched off.`}
                      className="absolute right-1 top-1 h-2 w-2 rounded-full"
                      style={{ background: "#f59e0b", boxShadow: "0 0 0 2px var(--shell-bg, #ffffff)" }}
                    />
                  )}
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
            space tucked out of the rail (featureConfig.more). Hidden when
            nothing is tucked away. Sits in the same gap-1 column as the nav
            rows, so the active pill's translateY math covers it too. */}
        {moreNav.length > 0 && (
          <div className="relative group">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className="relative z-10 flex items-center h-10 w-full"
              style={{
                paddingLeft: ICON_LEFT,
                color: moreActive ? "var(--shell-pill-fg, white)" : "var(--shell-fg, #374151)",
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
  // top-16), never re-mounting. The top edge and
  // top-right corner are squared off (no top border) so the rail reads as one
  // continuous L-shaped shell with the navbar. On the docked routes the card
  // gains a panel column beside the rail; the page portals its panel content
  // into the host below.
  return (
    <aside className="fixed left-0 top-16 z-40">
      {/* The card always runs from the navbar to the bottom of the viewport, flush
          against the left/bottom screen edges: those corners and borders are dropped
          so it reads as attached to the shell rather than floating.
          No paint on this wrapper (no white, no border): the panel column
          starts below a page's pinned tab bar, so a full-height rectangle or
          edge here would cut through the bar's band. The rail carries the
          card's left seam; the column carries its own right edge. */}
      <div className="flex overflow-hidden" style={{ height: RAIL_H }}>
        {/* Icon rail column — hover-expands; the only width that animates. Hover
            lives here (not the aside) so hovering the tree never expands the rail.
            Its border-r is the card's constant vertical seam: the closed card's
            right edge, the rail/panel divider when a panel is docked, and the
            line beside the pane tab bar (which starts one pixel in — PaneTabBar's
            -ml-[23px] — so this stays visible). */}
        <div
          className="relative flex shrink-0 flex-col overflow-hidden border-r"
          style={{
            background: "var(--shell-bg, #ffffff)",
            borderRightColor: "var(--shell-border, #e5e7eb)",
            // No +1 border column: the rail is fixed at z-40, so an overhanging
            // pixel would paint white OVER the frame box's left accent band
            // (the box must sit in front of the shell there — nothing of the
            // bar may cover it).
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
            "Create new" opens the same column and slides in over the host below.
            marginTop: the column element starts below any bar the page pins at
            the card top (dockTopInset); the flex stretch absorbs the margin, so
            no height math is needed and the bar's band holds no aside pixels at
            all. Ungated on purpose — the dock flag is already false while the
            column is closing, so a gate would slide it up into the bar's band
            mid-close. Animated like the width, since docked surfaces with
            different top bars must glide rather than teleport. */}
        {/* The shell insets <main> into a rounded card that starts
            SHELL_FRAME_GAP below the navbar and stops the same gap above the
            viewport bottom (AuthLayoutClient). The docked panel reads as part of
            that card, so it takes the same top/bottom insets, lines its left edge
            up with the card's (marginLeft closes the rail's railW → card's
            railW+SHELL_FRAME_GAP difference so the vertical band runs unbroken),
            and rounds its outer corners — otherwise its square edges poke past
            the card. */}
        <div
          className="relative shrink-0 overflow-hidden"
          style={{
            background: "var(--color-surface-1, #ffffff)",
            width: columnW,
            marginTop: dockTopInset + SHELL_FRAME_GAP,
            marginBottom: SHELL_FRAME_GAP + SHELL_FRAME_MARGIN,
            // Rail is railW wide (no +1 border column), so the full GAP closes
            // the distance to the card's left edge.
            marginLeft: SHELL_FRAME_GAP,
            borderTopLeftRadius: SHELL_FRAME_RADIUS,
            borderBottomLeftRadius: SHELL_FRAME_RADIUS,
            transition: `width ${dur} ${ease}, margin-top ${dur} ${ease}`,
          }}
        >
          {/* The panel's right edge (was the card wrapper's border-r, which spanned
              the bar band too). Lives inside the offset column so it starts below
              the bar and rides the clipping width; faded when closed so no stray
              hairline lingers off-dock. Card-content grey, NOT --shell-border:
              --shell-border is transparent so the rail carries no seam of its
              own, but this line divides panel from note INSIDE the card — it
              must stay visible or the tree bleeds into the note body. */}
          <div
            className="absolute right-0 top-0 z-20 h-full w-px"
            style={{ background: "var(--border-subtle, #e5e7eb)", opacity: docked || createOpen ? 1 : 0, transition: `opacity ${dur} ${ease}` }}
          />
          {/* Portal host: the page (MessagesClient / ConsoleShell) mounts its panel
              here. Inner width tracks the active route's panel so the content is
              revealed by the clipping column rather than reflowing as it opens.
              It also SLIDES with the column's leading edge (parked under the icon
              rail at -100%, like the Create panel above): the width change alone
              is a wipe over motionless content, which reads as snapping open even
              at the same duration. Travelling content is what gives the
              connections rail its glide, so the panel is glued to the widening
              edge on the same duration/easing. Transform is identity at rest, and
              every popup the tree opens portals to <body>, so nothing inside is
              trapped by the containing block this creates. */}
          <div
            ref={setHost}
            className="min-h-0"
            style={{
              width: panelW,
              height: '100%',
              transform: docked ? 'translateX(0)' : 'translateX(-100%)',
              transition: `transform ${dur} ${ease}`,
            }}
          />

          {/* "Create new" — a layer over the host, clipped by this column so it
              slides out from under the icon rail and covers whatever panel is
              docked. The column itself already starts below any bar the page
              pins at the card top (marginTop above), so top-0 here. */}
          {/* pointer-events-none while parked: the box still covers the docked
              panel (it's absolutely positioned over it) even with the panel
              slid out of view, so leaving it hit-testable made it swallow every
              wheel/click aimed at the docked tree — scrolling over the context
              tree did nothing while the graph behind it took the wheel. The
              panel re-enables events on itself once open. */}
          <div
            className={`absolute left-0 top-0 bottom-0 z-10 overflow-hidden ${createOpen ? '' : 'pointer-events-none'}`}
            // Fixed at the panel's FINAL width, not the column's animating one:
            // the slide is a translateX(-100%) of this box, so a width that grows
            // during the transition would keep moving the parked position and the
            // panel would trail the column's leading edge.
            style={{ width: createW }}
          >
            <CreateModal />
          </div>
        </div>
      </div>

      {/* "More" popup — the same centered modal shell as the Create-new modal,
          with a grid of the tools tucked out of the rail. Modal portals itself
          to <body>, which is what keeps the aside's entrance transform from
          trapping the fixed-position overlay inside the rail. */}
      {moreOpen && (
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
              {moreNav.map(({ href, label, icon }) => {
                const active = href === activeHref;
                return (
                  <Link
                    key={href}
                    href={href}
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
        </Modal>
      )}
    </aside>
  );
}
