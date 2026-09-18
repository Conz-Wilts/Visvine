'use client';

import { useEffect, useState } from 'react';
import { COLLAPSED_W } from '@/features/shared/components/layout/railRow';

/**
 * The desktop shell draws no title bar on macOS (apps/desktop/src/main.ts):
 * the page runs to the top of the window and the traffic lights float in the
 * rail, the way Slack's do — the group centred over the rail's column of
 * glyphs, with the same air either side of it.
 *
 * The lights stand 14pt in and 14pt down, and the group is 60pt wide, so the
 * rail is 14 + 60 + 14 = 88 wide and every glyph's centre (railW / 2) sits
 * under the middle light. The strip above the space is 40: the lights' centre
 * line is 21pt down, and 40 lands the space's tile 30pt below it, the gap
 * Slack leaves above its workspace tile.
 */
const MAC_TRAFFIC_LIGHT_INSET = 40;
const MAC_RAIL_W = 88;

type DesktopChrome = {
  /** The strip the window's controls take at the top of the rail. */
  inset: number;
  /** The closed rail's width, centred on the window's controls. */
  railW: number;
};

const BROWSER: DesktopChrome = { inset: 0, railW: COLLAPSED_W };
const MAC: DesktopChrome = { inset: MAC_TRAFFIC_LIGHT_INSET, railW: MAC_RAIL_W };

/** The room the window's controls take — the browser's shell everywhere but the mac app. */
export function useDesktopChrome(): DesktopChrome {
  const [chrome, setChrome] = useState(BROWSER);
  useEffect(() => {
    if (window.visvineDesktop?.platform === 'darwin') setChrome(MAC);
  }, []);
  return chrome;
}
