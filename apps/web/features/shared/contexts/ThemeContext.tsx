'use client';

import React, { useState, useEffect, ReactNode } from 'react';
import { createSafeContext } from './createSafeContext';

export interface ColorTheme {
  id: string;
  name: string;
  accent: string;
  accentDark: string;
  accentLight: string;
  pickerFilter: string;
  pickerFilterHover: string;
  /** The page backdrop for this set — a full `background` value painted on
      <body>. Built from the accent hue and a neighbour, white-forward through
      the middle so text and border tokens keep their contrast. */
  backdrop: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'green',
    name: 'Green',
    accent: '#78d870',
    accentDark: '#27693a',
    accentLight: '#eaf9ec',
    pickerFilter: 'brightness(0) saturate(100%) invert(71%) sepia(0%) saturate(1%) hue-rotate(154deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(73%) sepia(21%) saturate(584%) hue-rotate(75deg) brightness(95%) contrast(85%)',
    backdrop: 'linear-gradient(135deg, #d3f4d2 0%, #f4fcf3 42%, #ffffff 58%, #dff3ea 100%)',
  },
  {
    id: 'blue',
    name: 'Blue',
    accent: '#60a5fa',
    accentDark: '#1d4ed8',
    accentLight: '#eff6ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(60%) sepia(0%) saturate(1%) hue-rotate(200deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(63%) sepia(40%) saturate(500%) hue-rotate(195deg) brightness(100%) contrast(90%)',
    backdrop: 'linear-gradient(135deg, #d6e8ff 0%, #f2f7ff 42%, #ffffff 58%, #e3e2ff 100%)',
  },
  {
    id: 'purple',
    name: 'Purple',
    accent: '#a78bfa',
    accentDark: '#6d28d9',
    accentLight: '#f5f3ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(62%) sepia(10%) saturate(800%) hue-rotate(230deg) brightness(95%) contrast(88%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(55%) sepia(40%) saturate(600%) hue-rotate(240deg) brightness(100%) contrast(90%)',
    backdrop: 'linear-gradient(135deg, #e6dcff 0%, #f6f2ff 42%, #ffffff 58%, #ffe1f1 100%)',
  },
  {
    id: 'rose',
    name: 'Rose',
    accent: '#f87171',
    accentDark: '#b91c1c',
    accentLight: '#fff1f2',
    pickerFilter: 'brightness(0) saturate(100%) invert(55%) sepia(5%) saturate(200%) hue-rotate(320deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(52%) sepia(60%) saturate(600%) hue-rotate(330deg) brightness(100%) contrast(90%)',
    backdrop: 'linear-gradient(135deg, #ffdada 0%, #fff3f3 42%, #ffffff 58%, #ffe4d1 100%)',
  },
  {
    id: 'orange',
    name: 'Orange',
    accent: '#fb923c',
    accentDark: '#9a3412',
    accentLight: '#fff7ed',
    pickerFilter: 'brightness(0) saturate(100%) invert(65%) sepia(5%) saturate(200%) hue-rotate(20deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(62%) sepia(50%) saturate(600%) hue-rotate(15deg) brightness(100%) contrast(90%)',
    backdrop: 'linear-gradient(135deg, #ffe1c7 0%, #fff5ec 42%, #ffffff 58%, #fff1c2 100%)',
  },
  {
    id: 'yellow',
    name: 'Yellow',
    accent: '#facc15',
    accentDark: '#854d0e',
    accentLight: '#fefce8',
    pickerFilter: 'brightness(0) saturate(100%) invert(70%) sepia(5%) saturate(200%) hue-rotate(10deg) brightness(92%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(80%) sepia(60%) saturate(700%) hue-rotate(5deg) brightness(100%) contrast(92%)',
    backdrop: 'linear-gradient(135deg, #fff0b8 0%, #fffaea 42%, #ffffff 58%, #e6f7d6 100%)',
  },
  {
    id: 'teal',
    name: 'Teal',
    accent: '#2dd4bf',
    accentDark: '#0f766e',
    accentLight: '#f0fdfa',
    pickerFilter: 'brightness(0) saturate(100%) invert(70%) sepia(0%) saturate(1%) hue-rotate(170deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(72%) sepia(30%) saturate(500%) hue-rotate(155deg) brightness(95%) contrast(85%)',
    backdrop: 'linear-gradient(135deg, #c9f3ec 0%, #effcf9 42%, #ffffff 58%, #d9ecff 100%)',
  },
  {
    id: 'pink',
    name: 'Pink',
    accent: '#f472b6',
    accentDark: '#be185d',
    accentLight: '#fdf2f8',
    pickerFilter: 'brightness(0) saturate(100%) invert(60%) sepia(5%) saturate(200%) hue-rotate(295deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(58%) sepia(40%) saturate(600%) hue-rotate(295deg) brightness(100%) contrast(90%)',
    backdrop: 'linear-gradient(135deg, #ffd9ea 0%, #fff2f8 42%, #ffffff 58%, #ebe0ff 100%)',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    accent: '#818cf8',
    accentDark: '#3730a3',
    accentLight: '#eef2ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(58%) sepia(5%) saturate(400%) hue-rotate(210deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(55%) sepia(35%) saturate(600%) hue-rotate(220deg) brightness(100%) contrast(90%)',
    backdrop: 'linear-gradient(135deg, #dcdfff 0%, #f2f3ff 42%, #ffffff 58%, #d9ecff 100%)',
  },
];

const THEME_STORAGE_KEY = 'nb_color_theme';
const BACKDROP_STORAGE_KEY = 'nb_backdrop';

/** Whether the page sits on the set's gradient or on plain white. */
export type BackdropMode = 'gradient' | 'plain';

// The content region is one flat white surface that runs edge to edge: no
// frame, no inset, no rounded card. These three values describe that geometry
// for everything positioned against the region's edges (AuthLayoutClient,
// Sidebar's docked panel, PaneTopScrollbarMask, ConnectionsRail) so they all
// share a single source of truth.
export const SHELL_FRAME_GAP = 0;      // grey showing between region edge and content
export const SHELL_FRAME_MARGIN = 0;   // white between the region and the viewport right/bottom
export const SHELL_FRAME_RADIUS = 0;   // corner radius of the content region

// Shell chrome vars (navbar + sidebar rail). Consumed via var(--shell-*) in
// Navbar/Sidebar and the .shell-icon-btn classes in globals.css. The list is
// what the unmount cleanup below iterates.
const SHELL_VARS = [
  '--shell-bg', '--shell-fg', '--shell-fg-strong', '--shell-border',
  '--shell-fg-muted', '--shell-hover', '--shell-active-fg',
  '--shell-active-fg-hover', '--shell-active-bg',
] as const;

interface ThemeContextValue {
  theme: ColorTheme;
  setTheme: (themeId: string) => void;
  themes: ColorTheme[];
  backdropMode: BackdropMode;
  setBackdropMode: (mode: BackdropMode) => void;
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

  // Shell chrome. Navbar and rail paint nothing of their own — the body's
  // backdrop shows through — and meet the content with no seam:
  // --shell-border stays transparent so nothing frames the page.
  const shell: Record<(typeof SHELL_VARS)[number], string> = {
    '--shell-bg': 'transparent',
    '--shell-fg': '#374151',
    '--shell-fg-strong': '#111827',
    // The rail's resting ink: every row sits muted until it is the current
    // surface (fg-strong + semibold) or under the pointer.
    '--shell-fg-muted': '#111827',
    '--shell-border': 'transparent',
    '--shell-hover': 'rgba(17, 24, 39, 0.025)',
    '--shell-active-fg': theme.accent,
    '--shell-active-fg-hover': theme.accentDark,
    '--shell-active-bg': 'transparent',
  };
  SHELL_VARS.forEach(v => root.style.setProperty(v, shell[v]));

  // Structural color vars
  root.style.setProperty('--color-brand-black', '#111827');
  root.style.setProperty('--color-brand-grey', '#4b5563');
  root.style.setProperty('--color-brand-white', '#F9FAFB');
  // surface-1 is the one opaque surface (floats, cards, inputs). surface-2/3
  // are ink tints, not greys: on white they render as the old #f9fafb/#f3f4f6,
  // and over a gradient backdrop they tint it instead of painting a grey slab.
  root.style.setProperty('--surface-1', '#ffffff');
  root.style.setProperty('--surface-2', 'rgba(17, 24, 39, 0.025)');
  root.style.setProperty('--surface-3', 'rgba(17, 24, 39, 0.05)');
  root.style.setProperty('--border-subtle', '#e5e7eb');
  root.style.setProperty('--border-default', '#d1d5db');
  root.style.setProperty('--text-primary', '#111827');
  root.style.setProperty('--text-secondary', '#374151');
  root.style.setProperty('--text-muted', '#4b5563');
}

function applyBackdrop(theme: ColorTheme, mode: BackdropMode) {
  document.documentElement.style.setProperty(
    '--app-backdrop',
    mode === 'gradient' ? theme.backdrop : '#ffffff',
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorTheme>(COLOR_THEMES[0]);
  const [backdropMode, setBackdropModeState] = useState<BackdropMode>('gradient');

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const found = COLOR_THEMES.find(t => t.id === storedTheme) ?? COLOR_THEMES[0];
    setThemeState(found);
    applyAll(found);

    const mode: BackdropMode = localStorage.getItem(BACKDROP_STORAGE_KEY) === 'plain' ? 'plain' : 'gradient';
    setBackdropModeState(mode);
    applyBackdrop(found, mode);

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
    applyBackdrop(found, backdropMode);
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  };

  const setBackdropMode = (mode: BackdropMode) => {
    setBackdropModeState(mode);
    applyBackdrop(theme, mode);
    localStorage.setItem(BACKDROP_STORAGE_KEY, mode);
  };

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, themes: COLOR_THEMES, backdropMode, setBackdropMode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
