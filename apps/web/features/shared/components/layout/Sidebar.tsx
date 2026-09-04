"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCreateModal, useCreateSurface } from "@/features/shared/contexts/CreateModalContext";
import { useSidebar } from "@/features/shared/contexts/SidebarContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { useSpace } from "@/features/shared/contexts/SpaceContext";
import { SHELL_FRAME_GAP, SHELL_FRAME_MARGIN, SHELL_FRAME_RADIUS, SHELL_PANE_TOP, SHELL_TOP_BAR_H } from "@/features/shared/contexts/ThemeContext";
import { railFeatures, moreFeatures } from "@/features/shared/lib/features";
import { GLOBAL_NAV, GLOBAL_NAV_KEYS } from "@/features/shared/lib/globalNav";
import { DOCK_MS, DOCK_CLOSE_MS, DOCK_EASE } from "@/features/shared/contexts/SidebarContext";
import { useHoverIntent } from "@/features/shared/hooks/useHoverIntent";
import Modal from "@/components/ui/Modal";
import UserMenu from "@/features/auth/components/UserMenu";
import CreatePanel from "@/features/create/components/CreatePanel";
import SpaceSelector from "@/features/spaces/components/SpaceSelector";
import SpaceSwitcherPanel from "@/features/spaces/components/SpaceSwitcherPanel";
import type { SpaceFeatureConfig } from "@/lib/types";
import {
  COLLAPSED_W,
  EXPANDED_W,
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
// The rail's own panels — the space list and Create new — slide out beside
// the rail, which shuts to its glyph column as the pointer crosses into them,
// so the panel's width is its own: wide enough for a space's name beside its
// chevron and check, or a kind's name beside its mark, without clipping.
const RAIL_PANEL_W = 320;
const DOCK_MIN_WIDTH = 1024; // below this the docked panel would crowd the content — keep the page's inline layout instead
const RAIL_H = "100dvh"; // the rail is the shell: it owns the viewport's full height
// paddingBottom on the rail column. It matches SHELL_PANE_TOP, so the rail's
// last row and a page's content share the surface's bottom rhythm.
const RAIL_PAD_Y = SHELL_PANE_TOP;
// paddingTop is its own number, because the head row is aligned to the shell's
// top band rather than to the pane below it: the band is SHELL_TOP_BAR_H tall,
// so the space avatar — 40px in a ROW_H-tall row — starts where its centre lands on
// that band's centre line.
const RAIL_PAD_TOP = Math.max(0, (SHELL_TOP_BAR_H - ROW_H) / 2);
// A band boundary: the hairline sits ITEM_GAP below the last row and ITEM_GAP
// above the next one, so the bands are held apart by the rhythm the rows
// already have rather than by a number of their own.
const BAND_TOP = ITEM_GAP;
// The rail's width, opening and closing — and the motion of anything that
// must stay glued to its edge.
const RAIL_MOTION_MS = 300;
// After the rail has shut under a panel, the pointer is given this much
// longer before where it stands is judged (Sidebar#beginSlide).
const LEAVE_GRACE_MS = 150;
// A pointer left standing this far off the card was not reaching for the
// panel: the panels shut at once.
const LEAVE_FAR_PX = 200;
// A pointer left nearer than that may drift this much further away before
// that counts as walking off.
const LEAVE_SLACK_PX = 40;
const RAIL_MOTION = `${RAIL_MOTION_MS}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
export default function Sidebar() {
  const pathname = usePathname();
  const { isOpen: createOpen, formOpen: createFormOpen, close: closeCreate } = useCreateModal();
  const createSurface = useCreateSurface();
  const { expanded, setHovered, reduced, switcherOpen, setSwitcherOpen } = useSidebar();
  const { currentSpace, isAdmin, loading: spaceLoading } = useSpace();
  const { setHost, dockTopInset } = useContextPanel();
  // Rows that change which panel is out act only once the pointer has rested
  // on them: a pointer crossing the rail on its way into a panel must not
  // swap or shut what it is heading for.
  const intent = useHoverIntent();

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

  // The rail's own panels — the space switcher and Create new — are layers against
  // the rail's edge (below), not this column: clamped so they can't outgrow a
  // narrow viewport even beside the open rail.
  const railPanelW = `min(${RAIL_PANEL_W}px, calc(100vw - ${EXPANDED_W}px))`;
  const columnW = docked ? `${panelW}px` : "0px";
  // One of the rail's panels is out beside it. The rail is NOT held open under
  // a panel: the pointer crossing into the panel lets the rail shut to its
  // glyph column, and the panel — pinned to the rail's edge on the rail's own
  // motion — glides left with it, so the pair settles at a column of glyphs
  // and one list rather than two full columns side by side.
  const railPanelOpen = switcherOpen || createOpen;
  const railW = expanded ? EXPANDED_W : COLLAPSED_W;
  // A rail panel is open only while the pointer is on the row that opened it
  // or in the panel itself: pointing at any other row of the rail puts both
  // away — unless a Create form is being filled in, which holds that one the
  // way leaving the card does.
  const leaveRailPanels = () => {
    if (createOpen && !createFormOpen) closeCreate();
    if (switcherOpen) setSwitcherOpen(false);
  };
  // Shutting a panel is two moves in order, not one: the panel slides back
  // under the rail FIRST, then the rail lets go. Its box is pinned at the open
  // rail's edge, so a rail that shrank at the same moment would pull away from
  // under it and the two would read as collapsing towards each other.
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRelease = () => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
  };
  const shutRailPanels = () => {
    const panelsGone = reduced ? 0 : DOCK_MS;
    setSwitcherOpen(false);
    closeCreate();
    cancelRelease();
    releaseTimer.current = setTimeout(() => {
      releaseTimer.current = null;
      setHovered(false);
    }, panelsGone);
  };
  useEffect(() => cancelRelease, []);

  // The rail shutting under an open panel pulls the panel left, and a pointer
  // moving into the panel meets a box travelling the other way: it can end up
  // off the card without ever having walked off it, and the browser reports a
  // leave for that. So while the slide runs nothing is decided — leaves are
  // ignored and the pointer is only tracked — and once it has settled the
  // pointer's position is what counts: on the card, and the card's own leave
  // takes over again; beside it, and the panels shut only if it then moves
  // further away rather than back; far from it, and they shut at once.
  const asideRef = useRef<HTMLElement>(null);
  const phase = useRef<"slide" | "watch" | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const stopTracking = () => { cleanup.current?.(); cleanup.current = null; phase.current = null; };
  useEffect(() => stopTracking, []);
  const distanceTo = (box: DOMRect, x: number, y: number) =>
    Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
  // The card as the pointer meets it: the rail's column and whichever panel
  // boxes are open beside it. The panels are absolute, so the aside's own box
  // is only the rail; a parked panel is pointer-events-none and not counted.
  const cardBox = (): DOMRect | null => {
    const aside = asideRef.current;
    if (!aside) return null;
    let box: DOMRect | null = null;
    for (const child of Array.from(aside.children)) {
      if (child.classList.contains("pointer-events-none")) continue;
      const r = child.getBoundingClientRect();
      if (r.width === 0) continue;
      box = box
        ? new DOMRect(Math.min(box.left, r.left), Math.min(box.top, r.top), Math.max(box.right, r.right) - Math.min(box.left, r.left), Math.max(box.bottom, r.bottom) - Math.min(box.top, r.top))
        : r;
    }
    return box;
  };
  const beginSlide = (x: number, y: number) => {
    stopTracking();
    phase.current = "slide";
    const last = { x, y };
    const track = (m: MouseEvent) => { last.x = m.clientX; last.y = m.clientY; };
    document.addEventListener("mousemove", track);
    const settle = setTimeout(() => {
      document.removeEventListener("mousemove", track);
      cleanup.current = null;
      const box = cardBox();
      const d0 = box ? distanceTo(box, last.x, last.y) : Infinity;
      if (d0 === 0) return stopTracking();
      if (d0 > LEAVE_FAR_PX) { stopTracking(); return shutRailPanels(); }
      phase.current = "watch";
      const watch = (m: MouseEvent) => {
        const now = cardBox();
        const d = now ? distanceTo(now, m.clientX, m.clientY) : Infinity;
        if (d === 0) return stopTracking();
        if (d < d0 + LEAVE_SLACK_PX) return;
        stopTracking();
        shutRailPanels();
      };
      document.addEventListener("mousemove", watch);
      cleanup.current = () => document.removeEventListener("mousemove", watch);
    }, RAIL_MOTION_MS + LEAVE_GRACE_MS);
    cleanup.current = () => { document.removeEventListener("mousemove", track); clearTimeout(settle); };
  };
  const leaveCard = () => {
    if (!railPanelOpen) return;
    if (createOpen && createFormOpen) return;
    if (phase.current === "slide") return;
    stopTracking();
    shutRailPanels();
  };

  // Honour reduced-motion: collapse the width/margin transitions below to 0s.
  // Closing (nothing docked) runs faster than opening — the leaving panel
  // should be out of the way before the destination's content (the grid's
  // card cascade) is mid-animation beside it.
  const dur = reduced ? "0s" : `${docked ? DOCK_MS : DOCK_CLOSE_MS}ms`;


  const railInner = (
    <>
      {/* Head — which space you are looking at, and the band that unfolds
          under it (the console, New space — SpaceSelector). The
          band draws its own insets: the space's row on the head inset, its
          rows on the rail's. The page's own side panel is switched from the
          shell's top band (ShellTopBar), not here. */}
      <div className="flex shrink-0 flex-col" style={{ gap: ITEM_GAP }}>
        <SpaceSelector />

        {/* The top group — Create new, then Discover and Marketplace. It rides
            with the head rather than the nav below because it never scrolls:
            the one thing you come here to DO and the two ways out of this
            space stay put however many tools it has switched on.

            Create acts on the current space, so with none selected there is
            nothing for it to make (creating a space itself lives on the
            switcher above). Pointing at it is enough, the way the space
            is: the panel slides out beside the rail — every kind you can make
            here, searchable — and stays while the pointer is anywhere on the
            card. The kind decides what comes next: a short form in the panel,
            its own surface, or a draft note (lib/create/rows.ts). */}
        <div
          className="flex flex-col border-t"
          style={{
            gap: ITEM_GAP,
            paddingTop: ITEM_GAP,
            paddingLeft: ROW_INSET,
            paddingRight: ROW_INSET,
            // The line under the space is drawn by the space's own sheet
            // (SpaceSelector) — it is that sheet's bottom edge, which travels
            // down when it opens — so this border only holds the pixel.
            borderTopColor: "transparent",
          }}
        >
          {!noSpace && (
            <div
              {...intent(() => {
                // One panel at a time: the two share the edge of the rail.
                setSwitcherOpen(false);
                if (!createOpen) createSurface();
              })}
            >
            <Row
              expanded={expanded}
              reduced={reduced}
              label="Create new"
              active={createOpen}
              aria-expanded={createOpen}
              aria-haspopup="dialog"
              onClick={() => (createOpen ? closeCreate() : createSurface())}
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
            </div>
          )}

          {GLOBAL_NAV.map(({ key, href, label, icon }) => (
            <div key={key} {...intent(leaveRailPanels)}>
            <Row
              expanded={expanded}
              reduced={reduced}
              href={href}
              label={label}
              icon={icon}
              active={href === activeHref}
            />
            </div>
          ))}
        </div>
      </div>

      {/* Nav — what this space can do. It scrolls on its own when a space has
          more tools than the viewport is tall; the head and foot never move. */}
      <nav
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t"
        {...intent(leaveRailPanels)}
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
          {...intent(leaveRailPanels)}
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
        {...intent(leaveRailPanels)}
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
    <aside
      ref={asideRef}
      className="fixed left-0 top-0 z-40"
      // The rail's panels open under the pointer (the space row, the
      // Create new row), so they shut when the pointer leaves the whole card —
      // rail and panel both. A Create form being filled in is the exception:
      // it holds the card open until it is done or stepped back from.
      onMouseEnter={() => { if (phase.current === "watch") stopTracking(); }}
      onMouseLeave={leaveCard}
    >
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
            width: railW,
            paddingTop: RAIL_PAD_TOP,
            paddingBottom: RAIL_PAD_Y,
            transition: reduced ? "none" : `width ${RAIL_MOTION}`,
          }}
          // Coming back before a shutting panel has released the rail keeps it
          // open — the release is cancelled, not raced.
          onMouseEnter={() => { cancelRelease(); setHovered(true); }}
          // Leaving the rail shuts it, even into a panel beside it: the panel
          // travels left with the rail's edge, and the card ends up narrower.
          onMouseLeave={(e) => {
            if (railPanelOpen && expanded && !reduced) beginSlide(e.clientX, e.clientY);
            setHovered(false);
          }}
        >
          {railInner}
        </div>

        {/* The side panel, hosted inside this same card. Always mounted so the portal
            host stays stable and the column can transition its width open ↔ closed;
            off the docked routes it's a clipped 0-width sliver with an empty host.
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
              rail at -100%, like the rail's own panels): the width change alone
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


        </div>
      </div>

      {/* The rail's own panels — the space switcher and Create new — are
          layers against the rail's edge running the card's full height,
          so their search is at the very top beside the space, not below the
          shell's band the way the page's panel column is. Each slides out
          from under the rail; parked, it is clipped by its box. They hang off
          the aside rather than the card's overflow-hidden box above, because
          that box is only as wide as the rail and would scroll itself sideways
          to show a focused search. Each box's left edge IS the rail's edge,
          on the rail's own motion: a panel opened while the rail is still
          widening, or shut before it has finished, travels with that edge
          rather than sliding towards a place the rail has not reached yet —
          and when the pointer crosses into a panel and the rail shuts under
          it, the panel glides left to the glyph column's edge. One shows at a
          time (the rows that open them close the other), so they share the
          edge without a stack. */}
      <div
        className={`absolute top-0 bottom-0 z-20 overflow-hidden ${switcherOpen ? '' : 'pointer-events-none'}`}
        style={{ left: railW, width: railPanelW, transition: reduced ? "none" : `left ${RAIL_MOTION}` }}
      >
        <SpaceSwitcherPanel />
      </div>
      <div
        className={`absolute top-0 bottom-0 z-20 overflow-hidden ${createOpen ? '' : 'pointer-events-none'}`}
        style={{ left: railW, width: railPanelW, transition: reduced ? "none" : `left ${RAIL_MOTION}` }}
      >
        <CreatePanel />
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
