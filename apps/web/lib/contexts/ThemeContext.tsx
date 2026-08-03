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
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'green',
    name: 'Green',
    accent: '#78d870',
    accentDark: '#2f7a3e',
    accentLight: '#eaf9ec',
    pickerFilter: 'brightness(0) saturate(100%) invert(71%) sepia(0%) saturate(1%) hue-rotate(154deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(73%) sepia(21%) saturate(584%) hue-rotate(75deg) brightness(95%) contrast(85%)',
  },
  {
    id: 'blue',
    name: 'Blue',
    accent: '#60a5fa',
    accentDark: '#1d4ed8',
    accentLight: '#eff6ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(60%) sepia(0%) saturate(1%) hue-rotate(200deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(63%) sepia(40%) saturate(500%) hue-rotate(195deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'purple',
    name: 'Purple',
    accent: '#a78bfa',
    accentDark: '#6d28d9',
    accentLight: '#f5f3ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(62%) sepia(10%) saturate(800%) hue-rotate(230deg) brightness(95%) contrast(88%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(55%) sepia(40%) saturate(600%) hue-rotate(240deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'rose',
    name: 'Rose',
    accent: '#f87171',
    accentDark: '#dc2626',
    accentLight: '#fff1f2',
    pickerFilter: 'brightness(0) saturate(100%) invert(55%) sepia(5%) saturate(200%) hue-rotate(320deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(52%) sepia(60%) saturate(600%) hue-rotate(330deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'orange',
    name: 'Orange',
    accent: '#fb923c',
    accentDark: '#c2410c',
    accentLight: '#fff7ed',
    pickerFilter: 'brightness(0) saturate(100%) invert(65%) sepia(5%) saturate(200%) hue-rotate(20deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(62%) sepia(50%) saturate(600%) hue-rotate(15deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'teal',
    name: 'Teal',
    accent: '#2dd4bf',
    accentDark: '#0f766e',
    accentLight: '#f0fdfa',
    pickerFilter: 'brightness(0) saturate(100%) invert(70%) sepia(0%) saturate(1%) hue-rotate(170deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(72%) sepia(30%) saturate(500%) hue-rotate(155deg) brightness(95%) contrast(85%)',
  },
  {
    id: 'pink',
    name: 'Pink',
    accent: '#f472b6',
    accentDark: '#be185d',
    accentLight: '#fdf2f8',
    pickerFilter: 'brightness(0) saturate(100%) invert(60%) sepia(5%) saturate(200%) hue-rotate(295deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(58%) sepia(40%) saturate(600%) hue-rotate(295deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    accent: '#818cf8',
    accentDark: '#3730a3',
    accentLight: '#eef2ff',
    pickerFilter: 'brightness(0) saturate(100%) invert(58%) sepia(5%) saturate(400%) hue-rotate(210deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(55%) sepia(35%) saturate(600%) hue-rotate(220deg) brightness(100%) contrast(90%)',
  },
];

const THEME_STORAGE_KEY = 'nb_color_theme';

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

  // Structural color vars
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorTheme>(COLOR_THEMES[0]);

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const found = COLOR_THEMES.find(t => t.id === storedTheme) ?? COLOR_THEMES[0];
    setThemeState(found);
    applyAll(found);

    return () => {
      // Reset all vars when leaving auth routes
      const root = document.documentElement;
      ['--color-brand-green','--color-brand-dark-green','--color-brand-light-bg',
       '--color-brand-bg','--theme-picker-filter','--theme-picker-filter-hover',
       '--theme-accent-color','--color-brand-black','--color-brand-grey','--color-brand-white',
       '--surface-1','--surface-2','--surface-3','--border-subtle','--border-default',
       '--text-primary','--text-secondary','--text-muted']
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
