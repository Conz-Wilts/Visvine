/** The accent palettes a person picks from in Settings. Kept out of the
 *  client-only ThemeContext so the server can inline `themeBootScript`. */
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
    accentDark: '#27693a',
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
    accentDark: '#b91c1c',
    accentLight: '#fff1f2',
    pickerFilter: 'brightness(0) saturate(100%) invert(55%) sepia(5%) saturate(200%) hue-rotate(320deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(52%) sepia(60%) saturate(600%) hue-rotate(330deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'orange',
    name: 'Orange',
    accent: '#fb923c',
    accentDark: '#9a3412',
    accentLight: '#fff7ed',
    pickerFilter: 'brightness(0) saturate(100%) invert(65%) sepia(5%) saturate(200%) hue-rotate(20deg) brightness(90%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(62%) sepia(50%) saturate(600%) hue-rotate(15deg) brightness(100%) contrast(90%)',
  },
  {
    id: 'yellow',
    name: 'Yellow',
    accent: '#facc15',
    accentDark: '#854d0e',
    accentLight: '#fefce8',
    pickerFilter: 'brightness(0) saturate(100%) invert(70%) sepia(5%) saturate(200%) hue-rotate(10deg) brightness(92%) contrast(87%)',
    pickerFilterHover: 'brightness(0) saturate(100%) invert(80%) sepia(60%) saturate(700%) hue-rotate(5deg) brightness(100%) contrast(92%)',
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

export const THEME_STORAGE_KEY = 'nb_color_theme';

/** The accent vars the boot script sets. ThemeContext's `applyAll` sets the
 *  same three names, so the first paint and the hydrated page agree. */
const ACCENT_VARS = ['--color-brand-green', '--color-brand-dark-green', '--color-brand-light-bg'] as const;

/**
 * A blocking inline script that applies the stored accent before first paint.
 * ThemeContext applies it again after hydration, which alone would flash the
 * default green on every load for anyone who picked another colour.
 */
export function themeBootScript(): string {
  const palettes = Object.fromEntries(
    COLOR_THEMES.map(t => [t.id, [t.accent, t.accentDark, t.accentLight]]),
  );
  return `try{var p=${JSON.stringify(palettes)}[localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})];`
    + `if(p){var r=document.documentElement.style,n=${JSON.stringify(ACCENT_VARS)};`
    + `for(var i=0;i<n.length;i++)r.setProperty(n[i],p[i]);r.setProperty('--theme-accent-color',p[0]);}}catch(e){}`;
}
