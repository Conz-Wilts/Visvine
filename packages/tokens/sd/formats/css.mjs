// Web: `tokens.css` holds every value as a `--vv-*` custom property (light on
// :root, dark and each accent as attribute selectors on <html>); `theme.css` is
// the Tailwind v4 `@theme` that names the utilities after the same roles.
import { HEADER_LINES, cubicBezierCss, rem, shadowCss } from '../model.mjs';

const header = () => `/*\n${HEADER_LINES.map((l) => ` * ${l}`).join('\n')}\n */\n`;

export const cssVar = (segments) => `--vv-${segments.join('-')}`;

const fontStack = (families) =>
  families.map((f) => (/[\s]/.test(f) && !f.startsWith('-') ? `'${f}'` : f)).join(', ');

const block = (selector, lines) => (lines.length ? `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}\n` : '');

export function tokensCss(model) {
  const root = [];
  for (const r of model.roles) root.push(`${cssVar(['color', ...r.name])}: ${r.light};`);
  for (const s of model.space) root.push(`${cssVar(['space', s.key])}: ${rem(s.value)};`);
  for (const r of model.radius) root.push(`${cssVar(['radius', r.key])}: ${r.key === 'full' ? `${r.value}px` : rem(r.value)};`);
  for (const f of model.fontFamily) root.push(`${cssVar(['font', 'family', f.key])}: ${fontStack(f.value)};`);
  for (const w of model.fontWeight) root.push(`${cssVar(['font', 'weight', w.key])}: ${w.value};`);
  for (const s of model.fontSize) root.push(`${cssVar(['font', 'size', s.key])}: ${rem(s.value)};`);
  for (const s of model.shadow) root.push(`${cssVar(['shadow', s.key])}: ${shadowCss(s.value)};`);
  for (const d of model.duration) root.push(`${cssVar(['motion', 'duration', d.key])}: ${d.value}ms;`);
  for (const e of model.ease) root.push(`${cssVar(['motion', 'ease', e.key])}: ${cubicBezierCss(e.value)};`);
  for (const z of model.z) root.push(`${cssVar(['z', z.key])}: ${z.value};`);

  const dark = model.roles
    .filter((r) => r.dark !== r.light)
    .map((r) => `${cssVar(['color', ...r.name])}: ${r.dark};`);

  const accentLines = (set) => [
    `${cssVar(['color', 'accent'])}: ${set.default};`,
    `${cssVar(['color', 'accent', 'strong'])}: ${set.strong};`,
    `${cssVar(['color', 'accent', 'soft'])}: ${set.soft};`,
  ];
  const [defaultAccent, ...others] = model.accents;

  return [
    header(),
    '/* Light is the default and, for now, the only theme any app switches on. */',
    block(':root', root),
    `/* PROVISIONAL dark theme: generated, switched on nowhere. <html data-theme="dark"> would turn it on. */`,
    block('[data-theme="dark"]', dark),
    `/* The accent a person picks: <html data-accent="<id>">. ${defaultAccent.id} is the default and needs no attribute. */`,
    ...others.map((a) => block(`[data-accent="${a.id}"]`, accentLines(a.light))),
    ...others.map((a) => block(`[data-theme="dark"][data-accent="${a.id}"]`, accentLines(a.dark))),
  ].join('\n');
}

/** Tailwind's text scale, written in the product's px names. Line heights stay Tailwind's own. */
const TEXT_SCALE = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60 };

export function themeCss(model) {
  const lines = [];
  lines.push('/* Colour: utilities are named for the role — bg-surface, text-fg-muted, border-line-subtle, bg-accent, text-danger. */');
  for (const r of model.roles) lines.push(`--color-${r.name.join('-')}: var(${cssVar(['color', ...r.name])});`);

  lines.push('', '/* Radius: the same names Tailwind uses, now read from the tokens. */');
  for (const r of model.radius) {
    if (r.key === 'none' || r.key === 'full') continue;
    lines.push(`--radius-${r.key}: var(${cssVar(['radius', r.key])});`);
  }

  lines.push('', '/* Spacing: one step is space.1, so p-4 is still 16px. */');
  lines.push(`--spacing: var(${cssVar(['space', '1'])});`);

  lines.push('', '/* Type. */');
  const sizes = new Set(model.fontSize.map((s) => s.value));
  for (const [name, px] of Object.entries(TEXT_SCALE)) {
    if (!sizes.has(px)) throw new Error(`font.size.${px} is missing — Tailwind's text-${name} reads it`);
    lines.push(`--text-${name}: var(${cssVar(['font', 'size', String(px)])});`);
  }
  for (const f of model.fontFamily) lines.push(`--font-${f.key}: var(${cssVar(['font', 'family', f.key])});`);

  lines.push('', '/* Motion: ease-standard, ease-enter, … */');
  for (const e of model.ease) lines.push(`--ease-${e.key}: var(${cssVar(['motion', 'ease', e.key])});`);

  lines.push('', '/* Breakpoints are literal: a media query cannot read a custom property. */');
  for (const b of model.breakpoint) lines.push(`--breakpoint-${b.key}: ${rem(b.value)};`);

  return `${header()}\n@theme inline {\n${lines.map((l) => (l ? `  ${l}` : '')).join('\n')}\n}\n`;
}
