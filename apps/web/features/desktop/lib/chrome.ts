'use client';

import { useSyncExternalStore } from 'react';
import { COLLAPSED_W } from '@/features/shared/components/layout/railRow';
import { SHELL_TOP_BAR_H } from '@/features/shared/contexts/ThemeContext';

/**
 * The desktop shell draws no title bar on macOS (apps/desktop/src/main.ts):
 * the page runs to the top of the window and draws the window's frame itself,
 * the way Slack does — one tinted frame holding the traffic lights, the band
 * across the top and the rail down the left, with the content surface set into
 * it as a rounded sheet.
 *
 * The page says where the lights stand (the shell has no idea how wide this
 * release draws its rail): 14pt in and 14pt down, and the group is 60pt
 * wide, so the rail is 14 + 60 + 14 = 88 and every glyph's centre
 * (railW / 2) sits under the middle light. The band is 40: the lights' centre
 * line is 20pt down, the band's own middle, so the page's tabs and actions on
 * it stand level with them.
 *
 * In full screen macOS hides the lights in the menu bar's drop-down; the band
 * stays, because it carries the page's tabs and actions, and the rail keeps its
 * width, so nothing beside it moves sideways.
 */
const MAC_BAND_H = 40;
const MAC_LIGHTS = { x: 14, y: 14 };
const MAC_LIGHTS_W = 60;
const MAC_RAIL_W = MAC_LIGHTS.x * 2 + MAC_LIGHTS_W;

export type DesktopChrome = {
  /** The page draws the window's frame: band and rail on the frame tint, the
   *  content a rounded sheet set into it. */
  framed: boolean;
  /** The strip the window's controls take at the top of the rail. */
  inset: number;
  /** The shell's top band — ShellTopBar's height. <main> starts below it. */
  bandH: number;
  /** The closed rail's width, centred on the window's controls. */
  railW: number;
};

const BROWSER: DesktopChrome = { framed: false, inset: 0, bandH: SHELL_TOP_BAR_H, railW: COLLAPSED_W };
const MAC: DesktopChrome = { framed: true, inset: MAC_BAND_H, bandH: MAC_BAND_H, railW: MAC_RAIL_W };
const MAC_FULL_SCREEN: DesktopChrome = { ...MAC, inset: 0 };

// One read of the shell for every component that measures against it.
let chrome = BROWSER;
let started = false;
const listeners = new Set<() => void>();

function set(next: DesktopChrome) {
  if (next === chrome) return;
  chrome = next;
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const desktop = window.visvineDesktop;
  if (desktop?.platform !== 'darwin') return;
  desktop.setWindowControls?.(MAC_LIGHTS);
  set(MAC);
  const fullScreen = desktop.fullScreen;
  if (!fullScreen) return;
  const apply = (full: boolean) => set(full ? MAC_FULL_SCREEN : MAC);
  void fullScreen.get().then(apply);
  fullScreen.onChange(apply);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => { listeners.delete(listener); };
}

/** The room the window's controls take — the browser's shell everywhere but the mac app. */
export function useDesktopChrome(): DesktopChrome {
  return useSyncExternalStore(subscribe, () => chrome, () => BROWSER);
}

/** The frame's tint: the ink laid thinly over the surface, so it follows the
 *  theme — light and dark — without a colour of its own. */
export const FRAME_BG = 'color-mix(in srgb, var(--color-text-primary) 6%, var(--color-surface-1))';
/** The content sheet's corner where it meets the frame. */
export const FRAME_RADIUS = 12;
