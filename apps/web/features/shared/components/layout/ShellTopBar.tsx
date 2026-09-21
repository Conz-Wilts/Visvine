"use client";

import { useHeader } from "@/features/shared/contexts/HeaderContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { SHELL_TOP_BAR_H } from "@/features/shared/contexts/ThemeContext";
import { FRAME_RADIUS } from "@/features/desktop/lib/chrome";

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
 * empty and the band is bare — you are the rail's last row, not this one's.
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

  return (
    // paddingLeft: the first tab starts just past the sheet's rounded corner,
    // so its underline sits on the straight hairline; the actions run to the window's right edge.
    // In the desktop shell the band IS the title bar it replaced, so the bare
    // parts of it drag the window; everything on it opts back out.
    <div
      className="flex shrink-0 items-center gap-4 pr-1"
      style={{
        height: SHELL_TOP_BAR_H,
        paddingLeft: leftInset + FRAME_RADIUS + 4,
        transition: "padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)",
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
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
