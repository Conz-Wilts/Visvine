// TypeScript: the same values as data, for code that needs a colour or a
// number rather than a class — inline styles, canvas and SVG, the accent
// picker, the default type colours a new space starts with.
import { FEEDBACK, HEADER_LINES, cubicBezierCss, shadowCss } from '../model.mjs';
import { cssVar } from './css.mjs';

const header = () => `${HEADER_LINES.map((l) => `// ${l}`).join('\n')}\n`;
const lit = (v) => JSON.stringify(v, null, 2);

/** Nest `[a, b, c] → value` pairs into an object. */
function nest(pairs) {
  const out = {};
  for (const [segments, value] of pairs) {
    let at = out;
    segments.slice(0, -1).forEach((s) => (at = at[s] ??= {}));
    at[segments.at(-1)] = value;
  }
  return out;
}

const roleKey = (r) => (r.name.length === 1 ? [r.name[0], 'default'] : r.name);

export function indexTs(model) {
  const color = (mode) =>
    nest([
      ...model.roles.map((r) => [roleKey(r), r[mode]]),
      ...model.types.map((t) => [['type', t.name], t[mode]]),
    ]);
  const scale = (list, fmt = (v) => v) => Object.fromEntries(list.map((s) => [s.key, fmt(s.value)]));

  const out = [header()];
  out.push(`/** Raw ramps. Reach for these only to build data (a chart series, a hash palette); UI paints with \`color\`. */`);
  out.push(`export const palette = ${lit(model.palette)} as const;\n`);

  out.push(`/** Semantic colours, light theme — the one every app shows. \`default\` is the role itself. */`);
  out.push(`export const color = ${lit(color('light'))} as const;\n`);
  out.push(`/** PROVISIONAL dark theme, same shape as \`color\`. Switched on nowhere yet. */`);
  out.push(`export const colorDark = ${lit(color('dark'))} as const;\n`);

  out.push(`/** Every semantic colour as the custom property the web reads — for inline styles and SVG. */`);
  out.push(`export const cssVars = ${lit(nest(model.roles.map((r) => [roleKey(r), `var(${cssVar(['color', ...r.name])})`])))} as const;\n`);

  out.push(`/** Default link-type colours. */`);
  out.push(`export const relationColor = ${lit(Object.fromEntries(model.relations.map((r) => [r.name, r.value])))} as const;\n`);

  out.push(`export interface AccentSet { default: string; strong: string; soft: string }`);
  out.push(`export interface Accent { id: string; name: string; light: AccentSet; dark: AccentSet }`);
  out.push(`/** The hues a person picks from, default first. The id is what is stored. */`);
  out.push(`export const accents: readonly Accent[] = ${lit(model.accents)};\n`);

  out.push(`/** px */`);
  out.push(`export const space = ${lit(scale(model.space))} as const;\n`);
  out.push(`/** px */`);
  out.push(`export const radius = ${lit(scale(model.radius))} as const;\n`);
  out.push(`/** px, keyed by size */`);
  out.push(`export const fontSize = ${lit(scale(model.fontSize))} as const;\n`);
  out.push(`export const fontWeight = ${lit(scale(model.fontWeight))} as const;\n`);
  out.push(`export const fontFamily = ${lit(scale(model.fontFamily, (v) => v.map((f) => (/\s/.test(f) && !f.startsWith('-') ? `'${f}'` : f)).join(', ')))} as const;\n`);
  out.push(`/** CSS box-shadow values. */`);
  out.push(`export const shadow = ${lit(scale(model.shadow, shadowCss))} as const;\n`);
  out.push(`export const motion = ${lit({
    /** ms */
    duration: scale(model.duration),
    ease: scale(model.ease),
    easeCss: scale(model.ease, cubicBezierCss),
  })} as const;\n`);
  out.push(`export const z = ${lit(scale(model.z))} as const;\n`);
  out.push(`/** px */`);
  out.push(`export const breakpoint = ${lit(scale(model.breakpoint))} as const;\n`);

  out.push(`export type AccentId = ${model.accents.map((a) => JSON.stringify(a.id)).join(' | ')};`);
  out.push(`export type TypeName = keyof typeof color.type;`);
  out.push(`export type Feedback = ${FEEDBACK.map((f) => JSON.stringify(f)).join(' | ')};`);
  return out.join('\n') + '\n';
}
