import { palette } from '@visvine/tokens';

export interface ThemePalette {
  id: string;
  name: string;
  base: string;
  light: string;
  dark: string;
}

export const PALETTES: ThemePalette[] = [
  { id: 'green',  name: 'Forest',   base: palette.visvine[400], light: palette.visvine[50], dark: palette.visvine[700] },
  { id: 'blue',   name: 'Ocean',    base: palette.blue[500],    light: palette.blue[50],    dark: palette.blue[700] },
  { id: 'purple', name: 'Violet',   base: palette.violet[500],  light: palette.violet[50],  dark: palette.violet[700] },
  { id: 'orange', name: 'Ember',    base: palette.orange[500],  light: palette.orange[50],  dark: palette.orange[700] },
  { id: 'rose',   name: 'Rose',     base: palette.rose[500],    light: palette.rose[50],    dark: palette.rose[700] },
  { id: 'teal',   name: 'Teal',     base: palette.teal[500],    light: palette.teal[50],    dark: palette.teal[700] },
  { id: 'amber',  name: 'Gold',     base: palette.amber[500],   light: palette.amber[50],   dark: palette.amber[700] },
  { id: 'slate',  name: 'Midnight', base: palette.slate[500],   light: palette.slate[50],   dark: palette.slate[700] },
];

export function getPalette(id: string | undefined | null): ThemePalette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** Parse a 6-digit hex color into [r, g, b] (0–255). */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** Darken a hex color by blending toward black. */
function darkenHex(hex: string, amount = 0.35): string {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 - amount;
  const to2 = (n: number) => Math.round(n * f).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * Build a ThemePalette from any hex color (used for the "system" default
 * which derives from the space's node-type color).
 */
export function hexToPalette(hex: string): ThemePalette {
  const [r, g, b] = hexToRgb(hex);
  return {
    id: 'system',
    name: 'Default',
    base: hex,
    light: `rgba(${r}, ${g}, ${b}, 0.10)`,
    dark: darkenHex(hex, 0.38),
  };
}
