import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

export interface ColorTheme {
  id: string;
  name: string;
  accent: string;
  accentDark: string;
  accentLight: string;
  accentLightDark: string;
  accentBg: string;
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
  },
  {
    id: 'blue',
    name: 'Blue',
    accent: '#60a5fa',
    accentDark: '#1d4ed8',
    accentLight: '#eff6ff',
    accentLightDark: '#0f1f3d',
    accentBg: '#f5f7ff',
  },
  {
    id: 'purple',
    name: 'Purple',
    accent: '#a78bfa',
    accentDark: '#6d28d9',
    accentLight: '#f5f3ff',
    accentLightDark: '#1e1040',
    accentBg: '#f7f5ff',
  },
  {
    id: 'rose',
    name: 'Rose',
    accent: '#f87171',
    accentDark: '#dc2626',
    accentLight: '#fff1f2',
    accentLightDark: '#3d0a0a',
    accentBg: '#fff5f5',
  },
  {
    id: 'orange',
    name: 'Orange',
    accent: '#fb923c',
    accentDark: '#c2410c',
    accentLight: '#fff7ed',
    accentLightDark: '#3d1a05',
    accentBg: '#fdf8f5',
  },
  {
    id: 'teal',
    name: 'Teal',
    accent: '#2dd4bf',
    accentDark: '#0f766e',
    accentLight: '#f0fdfa',
    accentLightDark: '#05201e',
    accentBg: '#f5fdfb',
  },
  {
    id: 'pink',
    name: 'Pink',
    accent: '#f472b6',
    accentDark: '#be185d',
    accentLight: '#fdf2f8',
    accentLightDark: '#3d0a20',
    accentBg: '#fef5fb',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    accent: '#818cf8',
    accentDark: '#3730a3',
    accentLight: '#eef2ff',
    accentLightDark: '#12143d',
    accentBg: '#f5f5ff',
  },
];

const THEME_KEY = 'nb_color_theme';
const DARK_KEY = 'nb_dark_mode';

export interface DynamicColors {
  accent: string;
  accentDark: string;
  accentLight: string;
  accentBg: string;
  // Backgrounds
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textLight: string;
  // Borders
  borderLight: string;
  borderDefault: string;
  borderSubtle: string;
  // Status
  success: string;
  error: string;
  warning: string;
}

function buildColors(theme: ColorTheme, isDark: boolean): DynamicColors {
  if (isDark) {
    return {
      accent: theme.accent,
      accentDark: theme.accentDark,
      accentLight: theme.accentLightDark,
      accentBg: '#252524',
      bgPrimary: '#1c1c1a',
      bgSecondary: '#252524',
      bgTertiary: '#30302e',
      textPrimary: '#f1f5f9',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
      textLight: '#64748b',
      borderLight: '#3d3d3a',
      borderDefault: '#4a4a47',
      borderSubtle: 'rgba(255,255,255,0.06)',
      success: '#4ade80',
      error: '#f87171',
      warning: '#fbbf24',
    };
  }
  return {
    accent: theme.accent,
    accentDark: theme.accentDark,
    accentLight: theme.accentLight,
    accentBg: theme.accentBg,
    bgPrimary: '#ffffff',
    bgSecondary: '#f9fafb',
    bgTertiary: '#f3f4f6',
    textPrimary: '#111827',
    textSecondary: '#374151',
    textMuted: '#6b7280',
    textLight: '#9ca3af',
    borderLight: '#f3f4f6',
    borderDefault: '#e5e7eb',
    borderSubtle: 'rgba(0,0,0,0.06)',
    success: '#16a34a',
    error: '#ef4444',
    warning: '#f59e0b',
  };
}

interface ThemeContextValue {
  theme: ColorTheme;
  setTheme: (themeId: string) => void;
  themes: ColorTheme[];
  isDark: boolean;
  toggleDark: () => void;
  colors: DynamicColors;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorTheme>(COLOR_THEMES[0]);
  const [isDark, setIsDark] = useState(false);
  const [colors, setColors] = useState<DynamicColors>(buildColors(COLOR_THEMES[0], false));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [storedTheme, storedDark] = await Promise.all([
        SecureStore.getItemAsync(THEME_KEY),
        SecureStore.getItemAsync(DARK_KEY),
      ]);
      const dark = storedDark === 'true';
      const found = COLOR_THEMES.find(t => t.id === storedTheme) ?? COLOR_THEMES[0];
      setThemeState(found);
      setIsDark(dark);
      setColors(buildColors(found, dark));
      setLoaded(true);
    })();
  }, []);

  const setTheme = async (themeId: string) => {
    const found = COLOR_THEMES.find(t => t.id === themeId);
    if (!found) return;
    setThemeState(found);
    setColors(buildColors(found, isDark));
    await SecureStore.setItemAsync(THEME_KEY, themeId);
  };

  const toggleDark = async () => {
    const next = !isDark;
    setIsDark(next);
    setColors(buildColors(theme, next));
    await SecureStore.setItemAsync(DARK_KEY, String(next));
  };

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: COLOR_THEMES, isDark, toggleDark, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
