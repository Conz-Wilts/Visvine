"use client";

import { useState } from "react";
import { useHeader } from "@/features/shared/contexts/HeaderContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { useSidebar } from "@/features/shared/contexts/SidebarContext";
import { BAND_MOTION, FRAME_RADIUS, useDesktopChrome, useShellBand, useShellBandRoot } from "@/features/desktop/lib/chrome";

/*
 * The band across the top of the content surface — the shell's chrome AND the
 * page's, on one line:
 *
 *   Grid Context Table Resources                    Raw Share
 *
 * The tab set and the trailing page actions are portalled in by the pane shell
 * (PaneTabBar → shellTabsHost / shellTrailHost on ContextPanelContext), so a
 * page under the pane shell puts its sections and its actions on the band
 * rather than in a second bar below it. A page with neither leaves both hosts
 * empty, and a bare band is not drawn at all (useShellBand): it keeps its
 * hosts mounted at no height, so the next page's tabs have somewhere to land.
 *
 * There is no side-panel switch: a surface that has a panel — the context tree
 * beside a note, the channel list on /channels — keeps it open. The panel is
 * the page's spine, not an option.
 *
 * The band is the window's top edge, running its full width on the frame
 * (AuthLayoutClient) — so it is handed the rail's width, and its tabs start
 * just past the sheet's corner.
 */

export default function ShellTopBar({ leftInset = 0 }: { leftInset?: number }) {
  const { setShellTabsHost, setShellTrailHost } = useContextPanel();
  const { headerContent, headerRight } = useHeader();
  const { bandH } = useDesktopChrome();
  const { reduced } = useSidebar();
  // While the band travels it clips what stands on it, so tabs never spill
  // over the sheet; at rest it clips nothing (focus rings, menus).
  const [settledH, setSettledH] = useState(bandH);
  const moving = !reduced && settledH !== bandH;
  useShellBandRoot();
  useShellBand(!!headerContent || !!headerRight);

  return (
    // paddingLeft: the first tab starts just past the sheet's rounded corner,
    // so its underline sits on the straight hairline; the actions run to the window's right edge.
    // In the desktop shell the band IS the title bar it replaced, so the bare
    // parts of it drag the window; everything on it opts back out.
    <div
      className="flex shrink-0 items-center gap-4 pr-1"
      style={{
        height: bandH,
        overflow: bandH && !moving ? undefined : "hidden",
        paddingLeft: leftInset + FRAME_RADIUS + 4,
        transition: reduced ? "none" : `padding-left ${BAND_MOTION}, height ${BAND_MOTION}`,
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "height") setSettledH(bandH);
      }}
    >
      {/* The page's tab set (pane shell pages portal it in; empty elsewhere).
          It scrolls sideways before it ever pushes the actions out of the
          band. */}
      <div
        ref={setShellTabsHost}
        className="flex min-w-0 shrink items-center overflow-x-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      />

      {/* Centre: whatever the page hoists into the band (HeaderContext);
          empty on most surfaces — search lives in each page's own toolbar. */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <div className="w-full max-w-3xl" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          {headerContent}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        {/* Trailing page actions — Raw, Connections, Share — portalled in by
            the pane shell. */}
        <div ref={setShellTrailHost} className="flex shrink-0 items-center" />
        {headerRight}
      </div>
    </div>
  );
}
