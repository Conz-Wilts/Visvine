'use client';

import { useEffect, useState } from 'react';

/**
 * The desktop shell draws no title bar on macOS (apps/desktop/src/main.ts):
 * the page runs to the top of the window and the traffic lights float in the
 * rail. This is the strip they stand in — the rail reserves it above the
 * space, so nothing of the app sits under them.
 *
 * The lights are 14pt tall and stand at y 9 (main.ts), so 36 clears them by
 * the same margin Slack leaves above its workspace tile.
 */
const MAC_TRAFFIC_LIGHT_INSET = 36;

/** The space the window's controls take at the top left, 0 everywhere else. */
export function useDesktopChromeInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const desktop = window.visvineDesktop;
    if (desktop?.platform === 'darwin') setInset(MAC_TRAFFIC_LIGHT_INSET);
  }, []);
  return inset;
}
