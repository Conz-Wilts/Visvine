"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCreateModal, useCreateSurface } from "@/features/shared/contexts/CreateModalContext";
import { useSidebar } from "@/features/shared/contexts/SidebarContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { useSpace } from "@/features/shared/contexts/SpaceContext";
import { SHELL_FRAME_GAP, SHELL_FRAME_MARGIN, SHELL_FRAME_RADIUS, SHELL_PANE_TOP, SHELL_TOP_BAR_H } from "@/features/shared/contexts/ThemeContext";
import { railFeatures, moreFeatures } from "@/features/shared/lib/features";
import { GLOBAL_NAV, GLOBAL_NAV_KEYS } from "@/features/shared/lib/globalNav";
import { DOCK_MS, DOCK_CLOSE_MS, DOCK_EASE } from "@/features/shared/contexts/SidebarContext";
import Modal from "@/components/ui/Modal";
import UserMenu from "@/features/auth/components/UserMenu";
import CreateModal from "@/features/create/components/CreateModal";
import SpaceSelector from "@/features/spaces/components/SpaceSelector";
import type { SpaceFeatureConfig } from "@/lib/types";
import {
  COLLAPSED_W,
  EXPANDED_W,
  HEAD_INSET,
  ITEM_GAP,
  ROW_H,
  ROW_INSET,
  Row,
} from "@/features/shared/components/layout/railRow";

/*
 * The rail is the shell's chrome, and it carries everything that is not a
 * page: the space at its head, you at its foot. It runs the full height of the
 * viewport in four bands, and opens either on hover or from the switch in the
 * shell's top band (which pins it):
 *
 *  ┌──────────────────────────────────┐
 *  │ [space]  Blackbird Ventures      │  head: the space, and the page's panel
 *  ├──────────────────────────────────┤
 *  │ +  Create new                    │  top: the one thing you DO, and the two
 *  │ ◎  Discover                      │  ways out of this space — held apart
 *  │ ⬚  Marketplace                   │  from the tools by one hairline
 *  ├──────────────────────────────────┤
 *  │ ▣  Directory                     │  nav: what this space can do
 *  │ ▤  Channels …                    │
 *  ├──────────────────────────────────┤
 *  │ …  More                          │  foot: the tools the space tucked away
 *  ├──────────────────────────────────┤
 *  │ (you)                            │  account: your avatar and its menu
 *  └──────────────────────────────────┘
 *
 *  Every row is the same shape: a 48px glyph cell on one column, then a label
 *  the collapsed rail clips away with overflow-hidden. Shut, the rail is a
 *  column of glyphs and nothing else. Only the container's width animates —
 *  nothing flips.
 *
 * While the /channels list or a console section is docked, the card ALSO hosts
 * that panel beside the rail (the page portals into the host below via
 * ContextPanelContext), so the two read as one connected container.
 */

const CHANNELS_PANEL_W = 300; // /channels list panel width — keep in sync with MessagesClient
const DOCK_MIN_WIDTH = 1024; // below this the docked panel would crowd the content — keep the page's inline layout instead
const RAIL_H = "100dvh"; // the rail is the shell: it owns the viewport's full height
// paddingBottom on the rail column. It matches SHELL_PANE_TOP, so the rail's
// last row and a page's content share the surface's bottom rhythm.
const RAIL_PAD_Y = SHELL_PANE_TOP;
// paddingTop is its own number, because the head row is aligned to the shell's
// top band rather than to the pane below it: the band is SHELL_TOP_BAR_H tall,
// so the space avatar — 40px in a 48px row — starts where its centre lands on
// that band's centre line.
const RAIL_PAD_TOP = (SHELL_TOP_BAR_H - ROW_H) / 2;
// A band boundary: the hairline sits ITEM_GAP below the last row and ITEM_GAP
// above the next one, so the bands are held apart by the rhythm the rows
// already have rather than by a number of their own.
const BAND_TOP = ITEM_GAP;
export default function Sidebar() {
  const pathname = usePathname();
  const { isOpen: createOpen } = useCreateModal();
  const createSurface = useCreateSurface();
  const { expanded, setHovered, reduced } = useSidebar();
  const { currentSpace, isAdmin, loading: spaceLoading } = useSpace();
  const { setHost, dockTopInset } = useContextPanel();

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
  // rail. The head and foot stay — the space switcher is how you get back into
  // one. During the initial load the tools render as usual so the rail doesn't
  // flash empty on every page load.
  const noSpace = !spaceLoading && !currentSpace;
  // Whatever the top group already carries is dropped from the space's own
  // list — Directory is up there, so the rail below never shows it twice.
  const notInTopGroup = ({ key }: { key: string }) => !GLOBAL_NAV_KEYS.has(key);
  const allNav = noSpace ? [] : railFeatures(featureConfig, isAdmin, installedTools).filter(notInTopGroup);
  const moreNav = noSpace ? [] : moreFeatures(featureConfig, isAdmin, installedTools).filter(notInTopGroup);
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
  const activeHref = [...GLOBAL_NAV, ...allNav, ...moreNav]
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
  // Channels honours the shell band's panel switch (open by default) — the
  // page registers the panel so the switch shows, and closing hides the list.
  // The Space Console and Settings carry a pane-top tab bar instead (see
  // ConsoleShell), and the context tree is a column inside the note pane, so
  // every other route gets the plain rail.
  const docked = pathname.startsWith("/channels") && wide;
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


  const railInner = (
    <>
      {/* Head — which space you are looking at. Nothing switches here: the
          rail opens under the pointer, and the page's own side panel is
          switched from the shell's top band (ShellTopBar). */}
      <div className="flex shrink-0 flex-col" style={{ gap: ITEM_GAP }}>
        <div style={{ paddingLeft: HEAD_INSET, paddingRight: HEAD_INSET }}>
          <SpaceSelector />
        </div>

        {/* The top group — Create new, then Discover and Marketplace. It rides
            with the head rather than the nav below because it never scrolls:
            the one thing you come here to DO and the two ways out of this
            space stay put however many tools it has switched on.

            Create acts on the current space, so with none selected there is
            nothing for it to make (creating a space itself lives on the
            switcher above). No menu hangs off it: every type is a choice in the
            draft surface's own Type row, so it is one click to a surface you
            can type into rather than a list of decisions. */}
        <div className="flex flex-col" style={{ gap: ITEM_GAP, paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
          {!noSpace && (
            <Row
              expanded={expanded}
              reduced={reduced}
              label="Create new"
              onClick={() => createSurface()}
              icon={
                // The one row that MAKES something, so it is the one row that
                // is painted: a filled disc in the space's own accent rather
                // than a bare glyph, and drawn larger than a glyph so the row
                // you come here to press reads first. The glyph cell is a fixed
                // width, so the disc grows inside it without moving the name.
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full text-white"
                  style={{ background: "var(--theme-accent-color, #78d870)" }}
                >
                  <svg className="h-[26px] w-[26px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              }
            />
          )}

          {GLOBAL_NAV.map(({ key, href, label, icon }) => (
            <Row
              expanded={expanded}
              reduced={reduced}
              key={key}
              href={href}
              label={label}
              icon={icon}
              active={href === activeHref}
            />
          ))}
        </div>
      </div>

      {/* Nav — what this space can do. It scrolls on its own when a space has
          more tools than the viewport is tall; the head and foot never move. */}
      <nav
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t"
        style={{
          paddingLeft: ROW_INSET,
          paddingRight: ROW_INSET,
          paddingTop: ITEM_GAP,
          paddingBottom: ITEM_GAP,
          marginTop: BAND_TOP,
          // The one hairline between the surfaces that are yours and the ones
          // the space switched on — the same seam the foot uses.
          borderTopColor: "var(--shell-border, #e5e7eb)",
        }}
      >
        <div className="flex flex-col" style={{ gap: ITEM_GAP }}>
          {allNav.map(({ href, label, icon }) => (
            <Row
            expanded={expanded}
            reduced={reduced}
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={href === activeHref}
              badge={
                // Degraded install marker. Ringed in the rail's own background
                // so it reads as a badge on the icon rather than part of the
                // glyph, and it sits inside the icon cell so it travels with the
                // row whether the rail is collapsed or open.
                degradedHrefs.has(href) ? (
                  <span
                    title={`${label} is missing something it needs in this space — it runs with those parts switched off.`}
                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
                    style={{ background: "#f59e0b", boxShadow: "0 0 0 2px rgba(255,255,255,0.9)" }}
                  />
                ) : undefined
              }
            />
          ))}

        </div>
      </nav>

      {/* Foot — the tools the space tucked out of the rail (featureConfig.more).
          The space's own settings are not here: they hang off the space in the
          switcher at the head, the way the account's do off the avatar. */}
      {moreNav.length > 0 && (
        <div
          className="flex shrink-0 flex-col border-t"
          style={{
            gap: ITEM_GAP,
            marginTop: BAND_TOP,
            paddingTop: ITEM_GAP,
            paddingLeft: ROW_INSET,
            paddingRight: ROW_INSET,
            borderTopColor: "var(--shell-border, #e5e7eb)",
          }}
        >
          <Row
            expanded={expanded}
            reduced={reduced}
            label="More"
            onClick={() => setMoreOpen(true)}
            active={moreActive}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            icon={
              <svg fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
              </svg>
            }
          />
        </div>
      )}

      {/* Account — you, on the same glyph column as everything above. The rail
          is the shell's only chrome, so the avatar belongs at the end of it
          rather than floating over a page's top-right corner, and what hangs
          off it (Profile, Connectors, Settings, Sign out) grows upward inside
          the band as rail rows rather than in a menu over the page. */}
      <div
        className="flex shrink-0 flex-col border-t"
        style={{
          marginTop: BAND_TOP,
          paddingTop: ITEM_GAP,
          paddingLeft: ROW_INSET,
          paddingRight: ROW_INSET,
          borderTopColor: "var(--shell-border, #e5e7eb)",
        }}
      >
        <UserMenu expanded={expanded} reduced={reduced} />
      </div>
    </>
  );

  // ONE <aside> for both modes, so it's the same persistent element across
  // navigation — identical placement, never re-mounting. On the docked routes
  // the card gains a panel column beside the rail; the page portals its panel
  // content into the host below.
  return (
    <aside className="fixed left-0 top-0 z-40">
      {/* The card runs the viewport's full height, flush against the left and
          bottom screen edges: those corners and borders are dropped so it reads
          as attached to the shell rather than floating.
          No paint on this wrapper (no white, no border): the panel column
          starts below a page's pinned tab bar, so a full-height rectangle or
          edge here would cut through the bar's band. The rail carries the
          card's left seam; the column carries its own right edge. */}
      <div className="flex overflow-hidden" style={{ height: RAIL_H }}>
        {/* Icon rail column — the only width that animates, and only on the
            hover. Its border-r is the card's constant vertical seam: the closed
            card's right edge, the rail/panel divider when a panel is docked, and
            the line beside the pane tab bar (which starts one pixel in —
            PaneTabBar's -ml-[23px] — so this stays visible). */}
        <div
          className="relative flex shrink-0 flex-col overflow-hidden border-r"
          style={{
            background: "var(--shell-bg, #ffffff)",
            borderRightColor: "var(--shell-border, #e5e7eb)",
            width: expanded ? EXPANDED_W : COLLAPSED_W,
            paddingTop: RAIL_PAD_TOP,
            paddingBottom: RAIL_PAD_Y,
            transition: reduced ? "none" : "width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
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
            width: columnW,
            // dockTopInset is measured from <main>'s top; this column hangs in
            // the full-height aside, so it clears the shell's band as well.
            marginTop: SHELL_TOP_BAR_H + dockTopInset + SHELL_FRAME_GAP,
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
