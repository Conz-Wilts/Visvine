'use client';

import { useSyncExternalStore } from 'react';
import { COLLAPSED_W } from '@/features/shared/components/layout/railRow';
import { SHELL_TOP_BAR_H } from '@/features/shared/contexts/ThemeContext';

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
 * width and its top, so nothing in it moves.
 *
 * A browser has no controls to clear, so there the rail starts at the window's
 * top edge: the space's row is a square cell, which is its own margin.
 */
const MAC_LIGHTS = { x: 14, y: SHELL_TOP_BAR_H / 2 - 7 };
const MAC_RAIL_W = 72;

type DesktopChrome = {
  /** The part of the band the window's controls stand in. */
  inset: number;
  /** The closed rail's width, centred on the window's controls. */
  railW: number;
  /** Where the rail's first row starts: under the window's controls, or at the top where there are none. */
  railTop: number;
};

const BROWSER: DesktopChrome = { inset: 0, railW: COLLAPSED_W, railTop: 0 };
const MAC: DesktopChrome = { inset: SHELL_TOP_BAR_H, railW: MAC_RAIL_W, railTop: SHELL_TOP_BAR_H };
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

/** The frame: the surface itself, so the sheet is told apart by its line. */
export const FRAME_BG = 'var(--color-surface-1)';
/** The hairline between the frame and the sheet. */
export const FRAME_LINE = '1px solid var(--shell-border, #e5e7eb)';
/** The sheet's corner where the band and the rail meet. */
export const FRAME_RADIUS = 12;
