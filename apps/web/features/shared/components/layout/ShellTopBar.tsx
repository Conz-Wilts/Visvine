"use client";

import UserMenu from "@/features/auth/components/UserMenu";
import { useHeader } from "@/features/shared/contexts/HeaderContext";
import { useContextPanel } from "@/features/shared/contexts/ContextPanelContext";
import { SHELL_TOP_BAR_H } from "@/features/shared/contexts/ThemeContext";

/*
 * The band across the top of the content surface — the shell's chrome AND the
 * page's, on one line:
 *
 *   Grid Context Table Resources              Raw Share  (you)
 *
 * The tab set and the trailing page actions are portalled in by the pane shell
 * (PaneTabBar → shellTabsHost / shellTrailHost on ContextPanelContext), so a
 * page under the pane shell puts its sections and its actions on the band
 * rather than in a second bar below it. A page with neither leaves both hosts
 * empty and the band is just you.
 *
 * There is no side-panel switch: a surface that has a panel — the context tree
 * beside a note, the channel list on /channels — keeps it open. The panel is
 * the page's spine, not an option.
 */

export default function ShellTopBar() {
  const { setShellTabsHost, setShellTrailHost } = useContextPanel();
  const { headerContent, headerRight } = useHeader();

  return (
    // pl-8: the first tab's label starts on the same line as the page content
    // below it.
    <div className="flex shrink-0 items-center gap-4 pl-8 pr-4" style={{ height: SHELL_TOP_BAR_H }}>
      {/* The page's tab set (pane shell pages portal it in; empty elsewhere).
          It scrolls sideways before it ever pushes the actions out of the
          band. */}
      <div ref={setShellTabsHost} className="flex min-w-0 shrink items-center overflow-x-auto" />

      {/* Centre: whatever the page hoists into the band (HeaderContext);
          empty on most surfaces — search lives in each page's own toolbar. */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <div className="w-full max-w-3xl">{headerContent}</div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* Trailing page actions — Raw, Connections, Share — portalled in by
            the pane shell beside the account button. */}
        <div ref={setShellTrailHost} className="flex shrink-0 items-center" />
        {headerRight}
        <UserMenu />
      </div>
    </div>
  );
}
