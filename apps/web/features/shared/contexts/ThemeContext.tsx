'use client';

import React, { useState, useEffect, ReactNode } from 'react';
import { createSafeContext } from './createSafeContext';
import { ACCENT_ATTRIBUTE, COLOR_THEMES, THEME_STORAGE_KEY, type ColorTheme } from '../lib/colorThemes';

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

interface ThemeContextValue {
  theme: ColorTheme;
  setTheme: (themeId: string) => void;
  themes: ColorTheme[];
}

const [ThemeContext, useTheme] = createSafeContext<ThemeContextValue>('Theme');
export { useTheme };

/** The accent is an attribute: tokens.css holds every hue's colours under
 *  `[data-accent="<id>"]`. The date picker's glyph takes a CSS filter, which no
 *  colour token can express, so that one is still written as a property. */
function applyAll(theme: ColorTheme) {
  const root = document.documentElement;
  root.setAttribute(ACCENT_ATTRIBUTE, theme.id);
  root.style.setProperty('--theme-picker-filter', theme.pickerFilter);
  root.style.setProperty('--theme-picker-filter-hover', theme.pickerFilterHover);
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
      root.removeAttribute(ACCENT_ATTRIBUTE);
      root.style.removeProperty('--theme-picker-filter');
      root.style.removeProperty('--theme-picker-filter-hover');
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
