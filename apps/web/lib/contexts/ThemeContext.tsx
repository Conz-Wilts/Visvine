'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface ColorTheme {
  id: string;
  name: string;
  accent: string;
  accentDark: string;
  accentLight: string;     // light tint — used in light mode
  accentLightDark: string; // dark tint — used in dark mode
  accentBg: string;
  pickerFilter: string;
  pickerFilterHover: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'green',
    name: 'Green',
    accent: '#78d870',
    accentDark: '#2f7a3e',
    accentLight: '#eaf9ec',
    accentLightDark: '#0f2b14',
    accentBg: '#F5F7F5',
    pickerFilter: 'brightness(0) saturate(100%) invert(71%) sepia(0%) saturate(1%) hue-rotate(154deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(73%) sepia(21%) saturate(584%) hue-rotate(75deg) brightness(95%) contrast(85%)',
  },
  {
    id: 'blue',
    name: 'Blue',
    accent: '#60a5fa',
    accentDark: '#1d4ed8',
    accentLight: '#eff6ff',
    accentLightDark: '#0f1f3d',
    accentBg: '#f5f7ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(60%) sepia(0%) saturate(1%) hue-rotate(200deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(63%) sepia(40%) saturate(500%) hue-rotate(195deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'purple',
    name: 'Purple',
    accent: '#a78bfa',
    accentDark: '#6d28d9',
    accentLight: '#f5f3ff',
    accentLightDark: '#1e1040',
    accentBg: '#f7f5ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(62%) sepia(10%) saturate(800%) hue-rotate(230deg) brightness(95%) contrast(88%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(55%) sepia(40%) saturate(600%) hue-rotate(240deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'rose',
    name: 'Rose',
    accent: '#f87171',
    accentDark: '#dc2626',
    accentLight: '#fff1f2',
    accentLightDark: '#3d0a0a',
    accentBg: '#fff5f5',
    pickerFilter: 'brightness(0) saturate(100%) invert(55%) sepia(5%) saturate(200%) hue-rotate(320deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(52%) sepia(60%) saturate(600%) hue-rotate(330deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'orange',
    name: 'Orange',
    accent: '#fb923c',
    accentDark: '#c2410c',
    accentLight: '#fff7ed',
    accentLightDark: '#3d1a05',
    accentBg: '#fdf8f5',
    pickerFilter: 'brightness(0) saturate(100%) invert(65%) sepia(5%) saturate(200%) hue-rotate(20deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(62%) sepia(50%) saturate(600%) hue-rotate(15deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'teal',
    name: 'Teal',
    accent: '#2dd4bf',
    accentDark: '#0f766e',
    accentLight: '#f0fdfa',
    accentLightDark: '#05201e',
    accentBg: '#f5fdfb',
    pickerFilter: 'brightness(0) saturate(100%) invert(70%) sepia(0%) saturate(1%) hue-rotate(170deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(72%) sepia(30%) saturate(500%) hue-rotate(155deg) brightness(95%) contrast(85%)',
  },
  {
    id: 'pink',
    name: 'Pink',
    accent: '#f472b6',
    accentDark: '#be185d',
    accentLight: '#fdf2f8',
    accentLightDark: '#3d0a20',
    accentBg: '#fef5fb',
    pickerFilter: 'brightness(0) saturate(100%) invert(60%) sepia(5%) saturate(200%) hue-rotate(295deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(58%) sepia(40%) saturate(600%) hue-rotate(295deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    accent: '#818cf8',
    accentDark: '#3730a3',
    accentLight: '#eef2ff',
    accentLightDark: '#12143d',
    accentBg: '#f5f5ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(58%) sepia(5%) saturate(400%) hue-rotate(210deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(55%) sepia(35%) saturate(600%) hue-rotate(220deg) brightness(100%) contrast(90%)',
  },
];

const THEME_STORAGE_KEY = 'nb_color_theme';
const DARK_STORAGE_KEY = 'nb_dark_mode';

interface ThemeContextValue {
  theme: ColorTheme;
  setTheme: (themeId: string) => void;
  themes: ColorTheme[];
  isDark: boolean;
  toggleDark: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Blend two hex colors: mix `hex` into `base` at `amount` (0–1)
function blendHex(base: string, hex: string, amount: number): string {
  const b = parseInt(base.slice(1), 16);
  const h = parseInt(hex.slice(1), 16);
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const hr = (h >> 16) & 0xff, hg = (h >> 8) & 0xff, hb = h & 0xff;
  const r = Math.round(br + (hr - br) * amount);
  const g = Math.round(bg + (hg - bg) * amount);
  const blueC = Math.round(bb + (hb - bb) * amount);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${blueC.toString(16).padStart(2,'0')}`;
}

function applyAll(theme: ColorTheme, isDark: boolean) {
  const root = document.documentElement;

  // Accent color vars
  root.style.setProperty('--color-brand-green', theme.accent);
  root.style.setProperty('--color-brand-dark-green', theme.accentDark);
  root.style.setProperty('--color-brand-light-bg', isDark ? theme.accentLightDark : theme.accentLight);
  root.style.setProperty('--color-brand-bg', isDark ? blendHex('#252524', theme.accent, 0.04) : theme.accentBg);
  root.style.setProperty('--theme-picker-filter', theme.pickerFilter);
  root.style.setProperty('--theme-picker-filter-hover', theme.pickerFilterHover);
  root.style.setProperty('--theme-accent-color', theme.accent);

  // Structural color vars — dark mode overrides
  if (isDark) {
    root.style.setProperty('--color-brand-black', '#F1F5F9');
    root.style.setProperty('--color-brand-grey', '#94A3B8');
    root.style.setProperty('--color-brand-white', '#252524');
    // Semantic surface tokens — warm dark with subtle theme tint
    const s1 = blendHex('#30302e', theme.accent, 0.04); // card bg
    const s2 = blendHex('#3a3a38', theme.accent, 0.04); // secondary surface
    const s3 = blendHex('#444442', theme.accent, 0.04); // tertiary / hover
    root.style.setProperty('--surface-1', s1);
    root.style.setProperty('--surface-2', s2);
    root.style.setProperty('--surface-3', s3);
    root.style.setProperty('--border-subtle', '#3d3d3a');
    root.style.setProperty('--border-default', '#4a4a47');
    root.style.setProperty('--text-primary', '#f1f5f9');
    root.style.setProperty('--text-secondary', '#cbd5e1');
    root.style.setProperty('--text-muted', '#94a3b8');
  } else {
    root.style.setProperty('--color-brand-black', '#111827');
    root.style.setProperty('--color-brand-grey', '#6B7280');
    root.style.setProperty('--color-brand-white', '#F9FAFB');
    root.style.setProperty('--surface-1', '#ffffff');
    root.style.setProperty('--surface-2', '#f9fafb');
    root.style.setProperty('--surface-3', '#f3f4f6');
    root.style.setProperty('--border-subtle', '#e5e7eb');
    root.style.setProperty('--border-default', '#d1d5db');
    root.style.setProperty('--text-primary', '#111827');
    root.style.setProperty('--text-secondary', '#374151');
    root.style.setProperty('--text-muted', '#6b7280');
  }

  // Toggle Tailwind dark class
  root.classList.toggle('dark', isDark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorTheme>(COLOR_THEMES[0]);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const storedDark = localStorage.getItem(DARK_STORAGE_KEY) === 'true';
    const found = COLOR_THEMES.find(t => t.id === storedTheme) ?? COLOR_THEMES[0];
    setThemeState(found);
    setIsDark(storedDark);
    applyAll(found, storedDark);

    return () => {
      // Reset all vars and dark class when leaving auth routes
      const root = document.documentElement;
      ['--color-brand-green','--color-brand-dark-green','--color-brand-light-bg',
       '--color-brand-bg','--theme-picker-filter','--theme-picker-filter-hover',
       '--theme-accent-color','--color-brand-black','--color-brand-grey','--color-brand-white',
       '--surface-1','--surface-2','--surface-3','--border-subtle','--border-default',
       '--text-primary','--text-secondary','--text-muted']
        .forEach(v => root.style.removeProperty(v));
      root.classList.remove('dark');
    };
  }, []);

  const setTheme = (themeId: string) => {
    const found = COLOR_THEMES.find(t => t.id === themeId);
    if (!found) return;
    setThemeState(found);
    applyAll(found, isDark);
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  };

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    applyAll(theme, next);
    localStorage.setItem(DARK_STORAGE_KEY, String(next));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: COLOR_THEMES, isDark, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
