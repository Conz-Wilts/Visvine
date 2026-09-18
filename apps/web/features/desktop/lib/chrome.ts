'use client';

import { useEffect, useState } from 'react';
import { COLLAPSED_W } from '@/features/shared/components/layout/railRow';

/**
 * The desktop shell draws no title bar on macOS (apps/desktop/src/main.ts):
 * the page runs to the top of the window and the traffic lights float in the
 * rail, the way Slack's do — the group centred over the rail's column of
 * glyphs, with the same air either side of it.
 *
 * The page says where the lights stand (the shell has no idea how wide this
 * release draws its rail): 14pt in and 14pt down, and the group is 60pt
 * wide, so the rail is 14 + 60 + 14 = 88 and every glyph's centre
 * (railW / 2) sits under the middle light. The strip above the space is 40:
 * the lights' centre line is 21pt down, and its hairline sits clear under
 * them. The space below that line is a square of the rail's width.
 *
 * In full screen macOS hides the lights in the menu bar's drop-down, so the
 * strip goes; the rail keeps its width, so nothing beside it moves sideways.
 */
const MAC_TRAFFIC_LIGHT_INSET = 40;
const MAC_LIGHTS = { x: 14, y: 14 };
const MAC_LIGHTS_W = 60;
const MAC_RAIL_W = MAC_LIGHTS.x * 2 + MAC_LIGHTS_W;

type DesktopChrome = {
  /** The strip the window's controls take at the top of the rail. */
  inset: number;
  /** The closed rail's width, centred on the window's controls. */
  railW: number;
};

const BROWSER: DesktopChrome = { inset: 0, railW: COLLAPSED_W };
const MAC: DesktopChrome = { inset: MAC_TRAFFIC_LIGHT_INSET, railW: MAC_RAIL_W };
const MAC_FULL_SCREEN: DesktopChrome = { inset: 0, railW: MAC_RAIL_W };

/** The room the window's controls take — the browser's shell everywhere but the mac app. */
export function useDesktopChrome(): DesktopChrome {
  const [chrome, setChrome] = useState(BROWSER);
  useEffect(() => {
    const desktop = window.visvineDesktop;
    if (desktop?.platform !== 'darwin') return;
    desktop.setWindowControls?.(MAC_LIGHTS);
    setChrome(MAC);
    const fullScreen = desktop.fullScreen;
    if (!fullScreen) return;
    let live = true;
    const apply = (full: boolean) => { if (live) setChrome(full ? MAC_FULL_SCREEN : MAC); };
    void fullScreen.get().then(apply);
    const stop = fullScreen.onChange(apply);
    return () => { live = false; stop(); };
  }, []);
  return chrome;
}
