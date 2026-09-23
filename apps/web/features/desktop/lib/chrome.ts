'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { COLLAPSED_W } from '@/features/shared/components/layout/railRow';
import { SHELL_TOP_BAR_H } from '@/features/shared/contexts/ThemeContext';
import { motion } from '@visvine/tokens';

/**
 * The shell is a frame with the content set into it, the way Slack draws its
 * window: the band across the top and the rail down the left on the frame, and
 * the content a sheet held apart from them by one hairline with a rounded
 * corner where they meet (AuthLayoutClient).
 *
 * The mac app draws no title bar (apps/desktop/src/main.ts), so the traffic
 * lights stand in the band's left end, over the rail. The page says where
 * (the shell has no idea how wide this release draws its rail): 14pt in, and
 * down so their centre line is the band's middle. The group is 60pt wide and
 * ends at 74, so a 72pt rail is the narrowest that still clears it.
 *
 * In full screen macOS hides the lights in the menu bar's drop-down; the band
 * stays, because it carries the page's tabs and actions, and the rail keeps its
 * width, so nothing beside it moves sideways.
 *
 * The band is there only while something stands on it. A page with no tabs,
 * no actions and nothing hoisted (the Feed) gets no band: the sheet runs to the
 * window's top. In a browser the rail goes up with it, since nothing there
 * needs clearing; in the mac app the rail stays under the window's controls.
 */
const MAC_LIGHTS = { x: 14, y: SHELL_TOP_BAR_H / 2 - 7 };
const MAC_RAIL_W = 72;

type DesktopChrome = {
  /** The part of the band the window's controls stand in. */
  inset: number;
  /** The closed rail's width, centred on the window's controls. */
  railW: number;
  /** The band's height: 0 on a page that puts nothing on it. */
  bandH: number;
  /** Where the rail's first row starts. */
  railTop: number;
};

const BROWSER: DesktopChrome = { inset: 0, railW: COLLAPSED_W, bandH: SHELL_TOP_BAR_H, railTop: SHELL_TOP_BAR_H };
const MAC: DesktopChrome = { inset: SHELL_TOP_BAR_H, railW: MAC_RAIL_W, bandH: SHELL_TOP_BAR_H, railTop: SHELL_TOP_BAR_H };
const MAC_FULL_SCREEN: DesktopChrome = { ...MAC, inset: 0 };

// Each shell with its band gone. Built once, so a snapshot is a stable object.
const BARE = new Map<DesktopChrome, DesktopChrome>([
  [BROWSER, { ...BROWSER, bandH: 0, railTop: 0 }],
  [MAC, { ...MAC, bandH: 0 }],
  [MAC_FULL_SCREEN, { ...MAC_FULL_SCREEN, bandH: 0 }],
]);

// One read of the shell for every component that measures against it.
let shell = BROWSER;
let bandUsers = 0;
let bandBare = false;
let bareTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
const listeners = new Set<() => void>();

const snapshot = () => (bandBare ? BARE.get(shell) ?? shell : shell);
const emit = () => listeners.forEach((l) => l());

function set(next: DesktopChrome) {
  if (next === shell) return;
  shell = next;
  emit();
}

// A navigation takes one page's tabs off the band a moment before the next
// page's arrive, so the band goes only once it has stayed empty.
const BARE_AFTER_MS = 150;

function setBandBare(bare: boolean) {
  if (bareTimer) { clearTimeout(bareTimer); bareTimer = null; }
  if (bare === bandBare) return;
  if (!bare) { bandBare = false; emit(); return; }
  bareTimer = setTimeout(() => { bareTimer = null; bandBare = true; emit(); }, BARE_AFTER_MS);
}

/** Holds the band open while the caller has something on it. */
export function useShellBand(active = true) {
  useLayoutEffect(() => {
    if (!active) return;
    bandUsers += 1;
    setBandBare(false);
    return () => {
      bandUsers -= 1;
      if (bandUsers === 0) setBandBare(true);
    };
  }, [active]);
}

/** The shell's own claim: with no page holding the band, it goes. */
export function useShellBandRoot() {
  useLayoutEffect(() => {
    if (bandUsers === 0) setBandBare(true);
    return () => setBandBare(false);
  }, []);
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
  return useSyncExternalStore(subscribe, snapshot, () => BROWSER);
}

/** The band's motion when it comes and goes: the rail's own, so the frame moves as one. */
export const BAND_MOTION = `${motion.duration.base}ms ${motion.easeCss.gentle}`;

/** The frame: the surface itself, so the sheet is told apart by its line. */
export const FRAME_BG = 'var(--vv-color-surface)';
/** The hairline between the frame and the sheet. */
export const FRAME_LINE_COLOR = 'var(--vv-color-line-subtle)';
export const FRAME_LINE = `1px solid ${FRAME_LINE_COLOR}`;
/** The sheet's corner where the band and the rail meet. */
export const FRAME_RADIUS = 12;
