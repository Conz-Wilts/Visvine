"use client";

import Link from "@/features/shared/components/SpaceLink";
import { useRoutePathname } from "@/features/shared/hooks/useRoutePathname";
import { useEffect, useRef, useState } from "react";
import { useSidebar } from "@/features/shared/contexts/SidebarContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { useSpace } from "@/features/shared/contexts/SpaceContext";
import { SHELL_FRAME_GAP, SHELL_FRAME_MARGIN, SHELL_FRAME_RADIUS } from "@/features/shared/contexts/ThemeContext";
import { railFeatures, moreFeatures } from "@/features/shared/lib/features";
import { GLOBAL_NAV, GLOBAL_NAV_KEYS } from "@/features/shared/lib/globalNav";
import { CompassIcon, FeedIcon } from "@/features/shared/icons";
import { DOCK_MS, DOCK_CLOSE_MS, DOCK_EASE } from "@/features/shared/contexts/SidebarContext";
import { BAND_MOTION, FRAME_BG, FRAME_LINE, FRAME_RADIUS, useDesktopChrome } from "@/features/desktop/lib/chrome";
import Modal from "@/components/ui/Modal";
import UserMenu from "@/features/auth/components/UserMenu";
import SpaceSelector from "@/features/spaces/components/SpaceSelector";
import SpaceSwitcherPanel from "@/features/spaces/components/SpaceSwitcherPanel";
import type { SpaceFeatureConfig } from "@/lib/types";
import {
  EXPANDED_W,
  ITEM_GAP,
  ROW_INSET,
  RAIL_CELL_VAR,
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
 *  │ ≡  Feed                          │  top: the ways out of the space
 *  │ ◎  Discover                      │
 *  ├──────────────────────────────────┤
 *  │ ▣  Directory                     │  nav: what this space can do
 *  │ ▤  Channels …                    │
 *  ├──────────────────────────────────┤
 *  │ …  More                          │  foot: the tools the space tucked away
 *  ├──────────────────────────────────┤
 *  │ (you)                            │  account: your avatar and its menu
 *  └──────────────────────────────────┘
 *
 *  Every row is the same shape: a glyph cell the closed rail's width (76px;
 *  88 in the mac app, centred under the window's controls), then a label
 *  the collapsed rail clips away with overflow-hidden. Shut, the rail is a
 *  column of glyphs and nothing else. Only the container's width animates —
 *  nothing flips.
 *
 * Nothing on the rail makes anything: creation is asked of an AI over the
 * Visvine MCP server, and the app is where what it made is read and edited.
 *
 * While the /channels list or a console section is docked, the card ALSO hosts
 * that panel beside the rail (the page portals into the host below via
 * ContextPanelContext), so the two read as one connected container.
 */

const CHANNELS_PANEL_W = 300; // /channels list panel width — keep in sync with MessagesClient
// The rail's own panel — the space list — slides out beside the rail, which
// shuts to its glyph column as the pointer crosses into it, so the panel's
// width is its own: wide enough for a space's name beside its chevron and
// check without clipping.
const RAIL_PANEL_W = 340;
const DOCK_MIN_WIDTH = 1024; // below this the docked panel would crowd the content — keep the page's inline layout instead
const RAIL_H = "100dvh"; // the rail is the shell: it owns the viewport's full height
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
  const pathname = useRoutePathname();
  const { expanded, setHovered, reduced, switcherOpen, setSwitcherOpen } = useSidebar();
  const { currentSpace, isAdmin, loading: spaceLoading } = useSpace();
  const { setHost, dockTopInset } = useContextPanel();
  // The desktop shell's window controls stand in the band's left end, over
  // the rail, and the closed rail is wide enough to clear them.
  const { inset: chromeInset, railW: collapsedW, railTop, bandH } = useDesktopChrome();

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
  // No space selected (and not merely still loading one): the tools all act
  // on the current space, so none of them belong on the rail. The head and foot stay — the space switcher is how you get back into
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

  // "More" popup: a centered modal with a grid of the tucked-away tools. Modal handles Escape + backdrop dismissal.
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

  // The rail's own panel — the space switcher — is a layer against
  // the rail's edge (below), not this column: clamped so they can't outgrow a
  // narrow viewport even beside the open rail.
  const railPanelW = `min(${RAIL_PANEL_W}px, calc(100vw - ${EXPANDED_W}px))`;
  const columnW = docked ? `${panelW}px` : "0px";
  // One of the rail's panels is out beside it. The rail is NOT held open under
  // a panel: the pointer crossing into the panel lets the rail shut to its
  // glyph column, and the panel — pinned to the rail's edge on the rail's own
  // motion — glides left with it, so the pair settles at a column of glyphs
  // and one list rather than two full columns side by side.
  const railPanelOpen = switcherOpen;
  const railW = expanded ? EXPANDED_W : collapsedW;
  // Where a rail panel stands: the content sheet's box, below the band.
  const railPanelBox = (open: boolean): React.CSSProperties => ({
    top: bandH + SHELL_FRAME_GAP,
    bottom: SHELL_FRAME_GAP + SHELL_FRAME_MARGIN,
    left: railW + SHELL_FRAME_GAP,
    width: railPanelW,
    // The sheet's hairline, drawn by the panel where it covers the sheet's edge.
    // Only while out: a parked box must leave no line behind.
    borderTop: open ? FRAME_LINE : undefined,
    borderLeft: open ? FRAME_LINE : undefined,
    borderBottom: open ? FRAME_LINE : undefined,
    borderTopLeftRadius: FRAME_RADIUS,
    borderBottomLeftRadius: SHELL_FRAME_RADIUS,
    transition: reduced ? "none" : `left ${RAIL_MOTION}, top ${BAND_MOTION}`,
  });
  // The switcher is not put away by pointing: it goes when another row is
  // PRESSED.
  const pressRailRow = () => {
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
  // Both rail panels are lists, so leaving the card always puts one away —
  // there is nothing half-typed in either that leaving could throw away.
  const leaveCard = () => {
    if (!railPanelOpen) return;
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
          under it (Discover, the console, New space — SpaceSelector). The
          band draws its own insets: the space's row on the head inset, its
          rows on the rail's. The page's own side panel is switched from the
          shell's top band (ShellTopBar), not here. */}
      <div className="flex shrink-0 flex-col" style={{ gap: ITEM_GAP }}>
        <SpaceSelector />

        {/* The top group — Feed, then Discover. It rides with the head rather
            than the nav below because it never scrolls: the ways OUT to other
            spaces stay put however many tools the space has switched on. New
            space hangs off the space itself, in the switcher above. */}
        <div
          className="flex flex-col border-t"
          style={{
            gap: ITEM_GAP,
            paddingLeft: ROW_INSET,
            paddingRight: ROW_INSET,
            // The line under the space is drawn by the space's own sheet
            // (SpaceSelector) — it is that sheet's bottom edge, which pushes
            // this group down when it opens — so this border only holds the
            // pixel.
            borderTopColor: "transparent",
          }}
        >
          {/* Feed: the posts of every space you are in, in one stream. */}
          <div onClickCapture={pressRailRow}>
            <Row
              expanded={expanded}
              reduced={reduced}
              label="Feed"
              href="/feed"
              active={pathname === "/feed" || pathname.startsWith("/feed/")}
              icon={<FeedIcon className="!h-9 !w-9" strokeWidth={1.5} />}
            />
          </div>
          {/* Discover: the open spaces. It is here even with no space chosen,
              because it is where someone with none goes to find one. Like any
              tool row, pressing it puts the switcher away. */}
          <div onClickCapture={pressRailRow}>
            <Row
              expanded={expanded}
              reduced={reduced}
              label="Discover"
              href="/discover"
              active={pathname === "/discover" || pathname.startsWith("/discover/")}
              // Drawn larger than a glyph: the two rows of the top group are
              // a pair, and read as one.
              icon={<CompassIcon className="!h-9 !w-9" strokeWidth={1.5} />}
            />
          </div>
        </div>
      </div>

      {/* Nav — what this space can do. It scrolls on its own when a space has
          more tools than the viewport is tall; the head and foot never move. */}
      <nav
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t"
        onClickCapture={pressRailRow}
        style={{
          paddingLeft: ROW_INSET,
          paddingRight: ROW_INSET,
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
          onClickCapture={pressRailRow}
          style={{
            gap: ITEM_GAP,
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
        onClickCapture={pressRailRow}
        style={{
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
      // Every row's glyph cell (railRow) is the closed rail's inner width.
      style={{ [RAIL_CELL_VAR]: `${collapsedW - ROW_INSET * 2}px` } as React.CSSProperties}
      // The rail's panel opens under the pointer (the space row), so it shuts
      // when the pointer leaves the whole card — rail and panel both.
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
      <div className="relative flex overflow-hidden" style={{ height: RAIL_H }}>
        {/* Icon rail column — the only width that animates, and only on the
            hover. It draws no seam: the content sheet's hairline beside it is
            the divide. */}
        <div
          className="relative flex shrink-0 flex-col overflow-hidden"
          style={{
            // The rail is the frame's: no seam of its own, the content
            // sheet's hairline is the divide.
            background: FRAME_BG,
            width: railW,
            paddingTop: railTop,
            transition: reduced ? "none" : `width ${RAIL_MOTION}, padding-top ${BAND_MOTION}`,
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
          {/* The strip the window controls stand in, and the window's handle:
              dragging it moves the window, the way the title bar it replaced
              did. Nothing in a browser — chromeInset is 0 there. */}
          {chromeInset > 0 && (
            <div
              className="absolute inset-x-0 top-0"
              style={{
                height: chromeInset,
                WebkitAppRegion: "drag",
              } as React.CSSProperties}
            />
          )}
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
            marginTop: bandH + dockTopInset + SHELL_FRAME_GAP,
            marginBottom: SHELL_FRAME_GAP + SHELL_FRAME_MARGIN,
            // Rail is railW wide (no +1 border column), so the full GAP closes
            // the distance to the card's left edge.
            marginLeft: SHELL_FRAME_GAP,
            // The column is the sheet's left edge, so it carries the sheet's
            // hairline, and its rounded corner where it reaches the band.
            // Closed it is 0px wide, where a radius cannot bend: its edges
            // would draw a straight line past the sheet's own curve.
            background: "var(--color-surface-1)",
            borderLeft: docked ? FRAME_LINE : undefined,
            // The seam between the docked list and the content beside it. It
            // lives here rather than on the panel because the panel is exactly
            // as wide as this column's content box, so a border of its own
            // falls outside the clip and never draws.
            borderRight: docked ? FRAME_LINE : undefined,
            borderTop: docked && dockTopInset === 0 ? FRAME_LINE : undefined,
            borderTopLeftRadius: dockTopInset === 0 ? FRAME_RADIUS : SHELL_FRAME_RADIUS,
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

      {/* The rail's own panel — the space switcher — opens in
          the content area: below the shell's band, over the sheet's left edge,
          with the sheet's margins and rounded corner, so the band stays whole
          above them. Each slides out from under the rail; parked, it is
          clipped by its box. They hang off the aside rather than the card's
          overflow-hidden box above, because that box is only as wide as the
          rail and would scroll itself sideways to show a focused search. Each
          box's left edge follows the rail's edge, on the rail's own motion: a
          panel opened while the rail is still widening, or shut before it has
          finished, travels with that edge — and when the pointer crosses into
          a panel and the rail shuts under it, the panel glides left to the
          glyph column's edge. */}
      <div
        className={`absolute z-20 overflow-hidden ${switcherOpen ? '' : 'pointer-events-none'}`}
        style={railPanelBox(switcherOpen)}
      >
        <SpaceSwitcherPanel />
      </div>

      {/* "More" popup — a centered modal with a grid of the tools tucked out of the rail. Modal portals itself
          to <body>, which is what keeps the aside's entrance transform from
          trapping the fixed-position overlay inside the rail. */}
      {moreOpen && (
        <Modal
          onClose={() => setMoreOpen(false)}
          ariaLabel="More tools"
          maxWidth="max-w-xs"
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
