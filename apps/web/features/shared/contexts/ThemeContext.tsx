'use client';

import React, { useState, useEffect, ReactNode } from 'react';
import { createSafeContext } from './createSafeContext';
import { COLOR_THEMES, THEME_STORAGE_KEY, type ColorTheme } from '../lib/colorThemes';

// The content region is one flat white surface that runs edge to edge: no
// frame, no inset, no rounded card. These three values describe that geometry
// for everything positioned against the region's edges (AuthLayoutClient,
// Sidebar's docked panel, PaneTopScrollbarMask, ConnectionsRail) so they all
// share a single source of truth.
export const SHELL_FRAME_GAP = 0;      // grey showing between region edge and content
export const SHELL_FRAME_MARGIN = 0;   // white between the region and the viewport right/bottom
export const SHELL_FRAME_RADIUS = 0;   // corner radius of the content region

/** <main>'s top padding, and so the clearance above every bar a page pins at the
 *  top of the surface — the bars paint it themselves (`-top-6 -mt-6` plus an
 *  h-6 strip) so nothing scrolls through it. Anything that lines up with such a
 *  bar's bottom edge — the docked tree, the connections rail, the scrollbar
 *  mask — measures from here. */
export const SHELL_PANE_TOP = 24;

/** The shell's top band (ShellTopBar) when it is there: exactly a tab's height
 *  (PaneTabBar's h-12), so the tabs' underline sits on the sheet's top edge. A
 *  page with nothing on the band has none, so everything that measures against
 *  it reads `useDesktopChrome().bandH` (features/desktop/lib/chrome.ts), not this. */
export const SHELL_TOP_BAR_H = 48;

// Shell chrome vars — the sidebar rail, which is the shell's only chrome.
// Consumed via var(--shell-*) in Sidebar. The list is what the unmount cleanup
// below iterates.
const SHELL_VARS = [
  '--shell-bg', '--shell-fg-strong', '--shell-border', '--shell-fg-muted',
] as const;

interface ThemeContextValue {
  theme: ColorTheme;
  setTheme: (themeId: string) => void;
  themes: ColorTheme[];
}

const [ThemeContext, useTheme] = createSafeContext<ThemeContextValue>('Theme');
export { useTheme };

function applyAll(theme: ColorTheme) {
  const root = document.documentElement;

  // Accent color vars
  root.style.setProperty('--color-brand-green', theme.accent);
  root.style.setProperty('--color-brand-dark-green', theme.accentDark);
  root.style.setProperty('--color-brand-light-bg', theme.accentLight);
  root.style.setProperty('--color-brand-bg', '#ffffff');
  root.style.setProperty('--theme-picker-filter', theme.pickerFilter);
  root.style.setProperty('--theme-picker-filter-hover', theme.pickerFilterHover);
  root.style.setProperty('--theme-accent-color', theme.accent);

  // The page backdrop. Plain white, always — the shell paints nothing of its
  // own over it, and the Tool kit publishes it as `--vv-backdrop`.
  root.style.setProperty('--app-backdrop', '#ffffff');

  // Shell chrome. The rail paints nothing of its own — the body's backdrop
  // shows through — and --shell-border is the one line it draws: the hairline
  // down its right edge, so where the rail ends and the page begins is visible
  // rather than guessed at.
  const shell: Record<(typeof SHELL_VARS)[number], string> = {
    '--shell-bg': 'transparent',
    '--shell-fg-strong': '#111827',
    // The rail's resting ink: every row sits muted until it is the current
    // surface (fg-strong + semibold) or under the pointer.
    '--shell-fg-muted': '#111827',
    '--shell-border': '#e5e7eb',
  };
  SHELL_VARS.forEach(v => root.style.setProperty(v, shell[v]));

  // Structural color vars
  root.style.setProperty('--color-brand-black', '#111827');
  root.style.setProperty('--color-brand-grey', '#4b5563');
  root.style.setProperty('--color-brand-white', '#F9FAFB');
  // surface-1 is the one opaque surface (floats, cards, inputs). surface-2/3
  // are ink tints, not greys: over the white backdrop they render as
  // #f9fafb/#f3f4f6, and over any tinted surface they tint it rather than
  // painting a grey slab.
  root.style.setProperty('--surface-1', '#ffffff');
  root.style.setProperty('--surface-2', 'rgba(17, 24, 39, 0.025)');
  root.style.setProperty('--surface-3', 'rgba(17, 24, 39, 0.05)');
  root.style.setProperty('--border-subtle', '#e5e7eb');
  root.style.setProperty('--border-default', '#d1d5db');
  root.style.setProperty('--text-primary', '#111827');
  root.style.setProperty('--text-secondary', '#374151');
  root.style.setProperty('--text-muted', '#4b5563');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorTheme>(COLOR_THEMES[0]);

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const found = COLOR_THEMES.find(t => t.id === storedTheme) ?? COLOR_THEMES[0];
    setThemeState(found);
    applyAll(found);

    return () => {
      const root = document.documentElement;
      root.style.removeProperty('--app-backdrop');
      ['--color-brand-green','--color-brand-dark-green','--color-brand-light-bg',
       '--color-brand-bg','--theme-picker-filter','--theme-picker-filter-hover',
       '--theme-accent-color','--color-brand-black','--color-brand-grey','--color-brand-white',
       '--surface-1','--surface-2','--surface-3','--border-subtle','--border-default',
       '--text-primary','--text-secondary','--text-muted', ...SHELL_VARS]
        .forEach(v => root.style.removeProperty(v));
    };
  }, []);

  const setTheme = (themeId: string) => {
    const found = COLOR_THEMES.find(t => t.id === themeId);
    if (!found) return;
    setThemeState(found);
    applyAll(found);
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: COLOR_THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}
