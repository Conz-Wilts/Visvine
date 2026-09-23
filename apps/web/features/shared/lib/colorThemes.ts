import { accents } from '@visvine/tokens';

/** An accent a person picks from in Settings. Kept out of the client-only
 *  ThemeContext so the server can inline `themeBootScript`. The colours are the
 *  design tokens' accent hues (packages/tokens); tokens.css repaints the page
 *  for each one under `<html data-accent="<id>">`. */
export interface ColorTheme {
  id: string;
  name: string;
  /** Fills and the selected state — `--vv-color-accent`. */
  accent: string;
  /** Text and icons in the accent — `--vv-color-accent-strong`. */
  accentStrong: string;
  /** A wash behind a selected row — `--vv-color-accent-soft`. */
  accentSoft: string;
  /** A CSS filter that tints the native date picker's glyph (which no colour
   *  property reaches) grey at rest and the accent on hover. */
  pickerFilter: string;
  pickerFilterHover: string;
}

const PICKER_FILTERS: Record<string, [rest: string, hover: string]> = {
  green: [
    'brightness(0) saturate(100%) invert(71%) sepia(0%) saturate(1%) hue-rotate(154deg) brightness(90%) contrast(87%)',
    'brightness(0) saturate(100%) invert(73%) sepia(21%) saturate(584%) hue-rotate(75deg) brightness(95%) contrast(85%)',
  ],
  blue: [
    'brightness(0) saturate(100%) invert(60%) sepia(0%) saturate(1%) hue-rotate(200deg) brightness(90%) contrast(87%)',
    'brightness(0) saturate(100%) invert(63%) sepia(40%) saturate(500%) hue-rotate(195deg) brightness(100%) contrast(90%)',
  ],
  purple: [
    'brightness(0) saturate(100%) invert(62%) sepia(10%) saturate(800%) hue-rotate(230deg) brightness(95%) contrast(88%)',
    'brightness(0) saturate(100%) invert(55%) sepia(40%) saturate(600%) hue-rotate(240deg) brightness(100%) contrast(90%)',
  ],
  rose: [
    'brightness(0) saturate(100%) invert(55%) sepia(5%) saturate(200%) hue-rotate(320deg) brightness(90%) contrast(87%)',
    'brightness(0) saturate(100%) invert(52%) sepia(60%) saturate(600%) hue-rotate(330deg) brightness(100%) contrast(90%)',
  ],
  orange: [
    'brightness(0) saturate(100%) invert(65%) sepia(5%) saturate(200%) hue-rotate(20deg) brightness(90%) contrast(87%)',
    'brightness(0) saturate(100%) invert(62%) sepia(50%) saturate(600%) hue-rotate(15deg) brightness(100%) contrast(90%)',
  ],
  yellow: [
    'brightness(0) saturate(100%) invert(70%) sepia(5%) saturate(200%) hue-rotate(10deg) brightness(92%) contrast(87%)',
    'brightness(0) saturate(100%) invert(80%) sepia(60%) saturate(700%) hue-rotate(5deg) brightness(100%) contrast(92%)',
  ],
  teal: [
    'brightness(0) saturate(100%) invert(70%) sepia(0%) saturate(1%) hue-rotate(170deg) brightness(90%) contrast(87%)',
    'brightness(0) saturate(100%) invert(72%) sepia(30%) saturate(500%) hue-rotate(155deg) brightness(95%) contrast(85%)',
  ],
  pink: [
    'brightness(0) saturate(100%) invert(60%) sepia(5%) saturate(200%) hue-rotate(295deg) brightness(90%) contrast(87%)',
    'brightness(0) saturate(100%) invert(58%) sepia(40%) saturate(600%) hue-rotate(295deg) brightness(100%) contrast(90%)',
  ],
  indigo: [
    'brightness(0) saturate(100%) invert(58%) sepia(5%) saturate(400%) hue-rotate(210deg) brightness(90%) contrast(87%)',
    'brightness(0) saturate(100%) invert(55%) sepia(35%) saturate(600%) hue-rotate(220deg) brightness(100%) contrast(90%)',
  ],
};

export const COLOR_THEMES: ColorTheme[] = accents.map((a) => {
  const [rest, hover] = PICKER_FILTERS[a.id] ?? PICKER_FILTERS.green;
  return {
    id: a.id,
    name: a.name,
    accent: a.light.default,
    accentStrong: a.light.strong,
    accentSoft: a.light.soft,
    pickerFilter: rest,
    pickerFilterHover: hover,
  };
});

export const THEME_STORAGE_KEY = 'nb_color_theme';

/** The accent attribute tokens.css keys every accent's colours on. */
export const ACCENT_ATTRIBUTE = 'data-accent';

/**
 * A blocking inline script that applies the stored accent before first paint.
 * ThemeContext applies it again after hydration, which alone would flash the
 * default green on every load for anyone who picked another colour.
 */
export function themeBootScript(): string {
  const ids = COLOR_THEMES.map((t) => t.id);
  return `try{var a=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});`
    + `if(a&&${JSON.stringify(ids)}.indexOf(a)>=0)document.documentElement.setAttribute(${JSON.stringify(ACCENT_ATTRIBUTE)},a);}catch(e){}`;
}
