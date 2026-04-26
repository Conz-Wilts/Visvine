// Visnve Brand Colors - matching web app
export const colors = {
  // Brand colors
  brand: {
    green: '#78d870',
    darkGreen: '#2f7a3e',
    black: '#111827',
    grey: '#6B7280',
    white: '#F9FAFB',
    lightBg: '#eaf9ec',
    bg: '#F5F7F5',
  },

  // Semantic colors
  primary: '#78d870',
  primaryDark: '#2f7a3e',

  // Text colors
  text: {
    primary: '#111827',
    secondary: '#374151',
    muted: '#6b7280',
    light: '#9ca3af',
  },

  // Background colors
  background: {
    primary: '#ffffff',
    secondary: '#f9fafb',
    tertiary: '#f3f4f6',
  },

  // Border colors
  border: {
    light: '#f3f4f6',
    default: '#e5e7eb',
    dark: '#d1d5db',
  },

  // Status colors
  success: '#16a34a',
  successBg: '#dcfce7',
  error: '#ef4444',
  errorBg: '#fef2f2',
  warning: '#f59e0b',
  warningBg: '#fef3c7',
  info: '#2563eb',
  infoBg: '#eff6ff',
} as const;

export type ColorTheme = typeof colors;