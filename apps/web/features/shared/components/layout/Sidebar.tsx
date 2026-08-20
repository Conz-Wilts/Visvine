"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCreateModal, useCreateSurface } from "@/features/shared/contexts/CreateModalContext";
import { useSidebar } from "@/features/shared/contexts/SidebarContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { useSpace } from "@/features/shared/contexts/SpaceContext";
import { SHELL_FRAME_GAP, SHELL_FRAME_MARGIN, SHELL_FRAME_RADIUS } from "@/features/shared/contexts/ThemeContext";
import { railFeatures, moreFeatures, canAccessFeature } from "@/features/shared/lib/features";
import { DOCK_MS, DOCK_CLOSE_MS, DOCK_EASE } from "@/features/shared/contexts/SidebarContext";
import Modal from "@/components/ui/Modal";
import CreateModal from "@/features/create/components/CreateModal";
import type { SpaceFeatureConfig } from "@/lib/types";

/*
 * Layout model (nothing changes on expanded toggle except container width):
 *
 *  Container: width transitions COLLAPSED_W ↔ EXPANDED_W, overflow-hidden clips labels
 *  ┌──────────────────────────────────┐
 *  │ 12px │ 32px icon │ 12px │ label… │  ← each row is fixed layout
 *  └──────────────────────────────────┘
 *
 *  Collapsed: icon centered, label clipped
 *  Expanded: icon same spot, label revealed
 *  Transition: ONLY container width animates. Zero instant flips.
 *
 * The card always spans navbar → viewport bottom. While the /context page or a
 * profile's Context tab is active it ALSO hosts the notes tree (the embedded
 * workspace requests the dock and portals its tree into the host div below via
 * ContextPanelContext), so the icon rail + tree read as one connected container.
 */

// Exported so the AuthLayout's frame box and the rail track the exact same
// widths — change them here and the whole shell stays in sync.
export const COLLAPSED_W = 68;
export const EXPANDED_W = 224;
const NAVBAR_H = 64;   // fixed navbar the rail hangs below
const ROW_H = 48;      // row height, and the side of the square a collapsed row occupies
const ROW_INSET = (COLLAPSED_W - ROW_H) / 2; // row ↔ rail edge; the navbar avatar shares this column
// Icon cell → label gap. The label's left edge lands past the collapsed rail's
// right edge, so the overflow-hidden container clips it away entirely.
const LABEL_ML = COLLAPSED_W - ROW_INSET - ROW_H;
const ITEM_GAP = 12;   // airy spacing between rows — the rail is a column of glyphs, not a list
// The nav icons ship at h-5 w-5 from the feature registry (they are also drawn
// on the launcher cards at that size); the rail draws them at 28px unfilled, so
// each cell scales its own svg rather than the registry carrying a second set.
const GLYPH = "[&>svg]:h-7 [&>svg]:w-7";
// One row shape for every entry — Create, each tool, More. At rest a row is
// bare: no border, no fill, just the glyph (and the label once the rail is
// open). The soft block appears under the pointer only, which is what makes the
// rail read as a column of icons rather than a stack of buttons.
const ROW_CLASS =
  "relative z-10 flex w-full items-center rounded-[10px] transition-colors duration-150 hover:bg-surface-3";
const ROW_TEXT = "text-[15px] whitespace-nowrap";
const CHANNELS_PANEL_W = 300; // /channels list panel width — keep in sync with MessagesClient
const DOCK_MIN_WIDTH = 1024; // below this the docked panel would crowd the content — keep the page's inline layout instead
const RAIL_H = `calc(100dvh - ${NAVBAR_H}px)`; // rail card always runs from the navbar bottom to the viewport bottom
const RAIL_PAD_Y = 12; // paddingTop/paddingBottom on the rail column
const RAIL_GAP = 10; // gap between the Create block and the nav list

export default function Sidebar() {
  const pathname = usePathname();
  const { isOpen: createOpen } = useCreateModal();
  const createSurface = useCreateSurface();
  const { expanded, setExpanded, reduced } = useSidebar();
  const { currentSpace, isAdmin, loading: spaceLoading } = useSpace();
  const { setHost, contextOpen, dockTopInset } = useContextPanel();

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
  // The marketplace is a member surface — installing is what's admin-gated, and
  // that happens inside. What hides the row is the space switching Tools off (or
  // locking the key to admins); with no space chosen the catalogue is still
  // browsable, since the registry itself is global. It sits at the rail's bottom
  // edge rather than in the nav block: it is the shop the space installs from,
  // not one of the installed tools above it.
  const canAccessTools = !currentSpace || canAccessFeature(featureConfig, "tools", isAdmin);
  const toolsActive = pathname.startsWith("/tools");
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

  // "More" popup: a centered modal (same shell as the Create-new modal) with a
  // grid of the tucked-away tools. Modal handles Escape + backdrop dismissal.
  const [moreOpen, setMoreOpen] = useState(false);
  // Close on navigation (a tool card was clicked, or back/forward).
  useEffect(() => setMoreOpen(false), [pathname]);

  // On /channels (wide viewports only) the rail docks into a full-height card
  // hosting a side panel — the channel list. The page then portals its
  // content via ContextPanelContext.
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
  // The Space Console and Settings carry a pane-top tab bar instead (see
  // ConsoleShell), and the context tree is a column inside the note pane, so
  // every other route gets the plain rail.
  const docked = pathname.startsWith("/channels") && wide && contextOpen;
  const panelW = CHANNELS_PANEL_W;

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
  // Active is carried by weight and colour, not by a coloured pill: the current
  // surface is the dark, semibold row; everything else sits muted until hovered.
  const rowColor = (active: boolean) =>
    active ? "var(--shell-fg-strong, #111827)" : "var(--shell-fg-muted, #6b7280)";

  const railInner = (
    <>
      {/* The nav block rides the vertical centre of the rail (Instagram's
          layout): the navbar carries the space identity above it, and More
          is pinned to the bottom edge below. */}
      <div className="flex flex-col" style={{ gap: RAIL_GAP }}>
        {/* Create — creates things INSIDE the current space, so it goes with the
            tools when no space is selected (creating a space itself lives on the
            switcher, not here). No menu hangs off it: every type is a choice in
            the draft surface's own Type row, so it is one click to a surface you
            can type into rather than a list of decisions. */}
        {!noSpace && (
          <div className="relative group" style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
            <button onClick={() => createSurface()} className={ROW_CLASS} style={{ height: ROW_H, color: rowColor(false) }}>
              <span className="flex items-center justify-center shrink-0" style={{ width: ROW_H, height: ROW_H }}>
                <svg fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" viewBox="0 0 24 24" className="h-9 w-9">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className={ROW_TEXT} style={{ marginLeft: LABEL_ML }}>Create new</span>
            </button>
            {!expanded && (
              <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
                style={{ left: COLLAPSED_W + 4 }}
              >
                Create new
              </span>
            )}
          </div>
        )}

        {/* Nav items */}
        <nav className="relative flex flex-col" style={{ gap: ITEM_GAP }}>
          {allNav.map(({ href, label, icon }) => {
            const active = href === activeHref;
            return (
              <div key={href} className="relative group" style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
                <Link
                  href={href}
                  className={ROW_CLASS}
                  style={{ height: ROW_H, color: rowColor(active), transition: "color 0.2s, background-color 0.15s" }}
                >
                  {/* Icon: square cell, centered — collapsed it IS the row */}
                  <span className={`relative flex items-center justify-center shrink-0 ${GLYPH}`} style={{ width: ROW_H, height: ROW_H }}>
                    {icon}
                    {/* Degraded install marker. Ringed in the rail's own
                        background so it reads as a badge on the icon rather than
                        part of the glyph, and it sits inside the icon cell so it
                        travels with the row whether the rail is collapsed or open. */}
                    {degradedHrefs.has(href) && (
                      <span
                        title={`${label} is missing something it needs in this space — it runs with those parts switched off.`}
                        className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
                        style={{ background: "#f59e0b", boxShadow: "0 0 0 2px var(--shell-bg, #ffffff)" }}
                      />
                    )}
                  </span>
                  {/* Label: always present, clipped by container overflow-hidden when collapsed */}
                  <span className={`${ROW_TEXT} ${active ? "font-semibold" : "font-normal"}`} style={{ marginLeft: LABEL_ML }}>
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
      </div>

      {/* Bottom edge of the rail, out of the centred block's flow: the Tools
          marketplace, then "More" (the tools the space tucked out of the rail,
          featureConfig.more — hidden when nothing is tucked away). */}
      <div
        className="absolute inset-x-0 flex flex-col"
        style={{ bottom: RAIL_PAD_Y, gap: ITEM_GAP, paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}
      >
        {canAccessTools && (
          <div className="relative group">
            <Link
              href="/tools"
              className={ROW_CLASS}
              style={{ height: ROW_H, color: rowColor(toolsActive), transition: "color 0.2s, background-color 0.15s" }}
            >
              <span className="flex items-center justify-center shrink-0" style={{ width: ROW_H, height: ROW_H }}>
                <svg className="h-7 w-7 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="8" height="8" rx="1.5" />
                  <rect x="13" y="3" width="8" height="8" rx="1.5" />
                  <rect x="3" y="13" width="8" height="8" rx="1.5" />
                  <path d="M17 13v8M13 17h8" />
                </svg>
              </span>
              <span className={`${ROW_TEXT} ${toolsActive ? "font-semibold" : "font-normal"}`} style={{ marginLeft: LABEL_ML }}>
                Tools
              </span>
            </Link>

            {!expanded && (
              <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
                style={{ left: COLLAPSED_W + 4 }}
              >
                Tools
              </span>
            )}
          </div>
        )}

        {moreNav.length > 0 && (
          <div className="relative group">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className={ROW_CLASS}
              style={{ height: ROW_H, color: rowColor(moreActive), transition: "color 0.2s, background-color 0.15s" }}
            >
              {/* Three stacked bars — the same "more" glyph the flyout opens from */}
              <span className="flex items-center justify-center shrink-0" style={{ width: ROW_H, height: ROW_H }}>
                <svg className="h-7 w-7 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" viewBox="0 0 24 24">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </span>
              <span className={`${ROW_TEXT} ${moreActive ? "font-semibold" : "font-normal"}`} style={{ marginLeft: LABEL_ML }}>
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
      </div>
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
            width: expanded ? EXPANDED_W : COLLAPSED_W,
            paddingTop: RAIL_PAD_Y,
            // The nav block centres on the VIEWPORT, not on the rail: the rail
            // starts NAVBAR_H below the top, so padding the same amount onto its
            // bottom lifts the centred block by half the navbar and the column
            // reads as centred on screen.
            paddingBottom: RAIL_PAD_Y + NAVBAR_H,
            justifyContent: "center",
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
        {/* The docked panel reads as part of the content surface
            (AuthLayoutClient), so it takes the same edge geometry — the
            SHELL_FRAME_* constants — and lines its left edge up with the
            surface's so the vertical band runs unbroken. */}
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
          panelClassName="relative rounded-xl bg-surface-1 shadow-float"
          panelStyle={{ animation: "moreModalIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          <div className="relative flex items-center justify-center px-6 pt-5 pb-3">
            <h2 className="font-semibold text-text-primary text-base">More tools</h2>
            <button
              onClick={() => setMoreOpen(false)}
              aria-label="Close"
              className="absolute right-4 w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:bg-surface-3 hover:text-text-primary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* One row per tool: glyph, label, nothing else. The current page is
              weight + ink, the same signal the rail uses. */}
          <ul className="px-2 pb-3">
            {moreNav.map(({ href, label, icon }) => {
              const active = href === activeHref;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`flex items-center gap-4 rounded-[10px] px-4 py-3 transition-colors hover:bg-surface-3 ${
                      active ? "font-semibold text-text-primary" : "text-text-secondary"
                    }`}
                  >
                    <span className="flex h-7 w-7 items-center justify-center [&>svg]:h-6 [&>svg]:w-6">{icon}</span>
                    <span className="text-[15px]">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

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
