export interface ThemePalette {
  id: string;
  name: string;
  base: string;
  light: string;
  dark: string;
}

export const PALETTES: ThemePalette[] = [
  { id: 'green',  name: 'Forest',   base: '#78d870', light: '#eaf9ec', dark: '#2f7a3e' },
  { id: 'blue',   name: 'Ocean',    base: '#3b82f6', light: '#eff6ff', dark: '#1d4ed8' },
  { id: 'purple', name: 'Violet',   base: '#8b5cf6', light: '#f5f3ff', dark: '#6d28d9' },
  { id: 'orange', name: 'Ember',    base: '#f97316', light: '#fff7ed', dark: '#c2410c' },
  { id: 'rose',   name: 'Rose',     base: '#f43f5e', light: '#fff1f2', dark: '#be123c' },
  { id: 'teal',   name: 'Teal',     base: '#14b8a6', light: '#f0fdfa', dark: '#0f766e' },
  { id: 'amber',  name: 'Gold',     base: '#f59e0b', light: '#fffbeb', dark: '#b45309' },
  { id: 'slate',  name: 'Midnight', base: '#64748b', light: '#f8fafc', dark: '#334155' },
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
 * which derives from the community's node-type color).
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
