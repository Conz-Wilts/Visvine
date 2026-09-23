// The one read of a resolved token dictionary. Style Dictionary parses the DTCG
// source and resolves every reference; this folds the result into the shape
// every platform format renders from, so the formats only ever decide HOW a
// value is written, never WHICH values exist.

/** A token's path with a trailing `default` dropped — `color.fg.default` is `color.fg`. */
export function roleSegments(path) {
  return path.at(-1) === 'default' ? path.slice(0, -1) : path;
}

export function camel(segments) {
  return segments
    .flatMap((s) => String(s).split('-'))
    .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join('');
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()`/`rgba()` → 0–255 channels and 0–1 alpha. */
export function parseColor(value) {
  const v = String(value).trim();
  let m = v.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) throw new Error(`Unreadable colour ${v}`);
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: alpha };
  }
  throw new Error(`Unreadable colour ${v}`);
}

/** `16px` → 16. Durations: `150ms` → 150. */
export function num(value) {
  const n = parseFloat(String(value));
  if (Number.isNaN(n)) throw new Error(`Not a number: ${value}`);
  return n;
}

const byPath = (tokens) => new Map(tokens.map((t) => [t.path.join('.'), t]));

/** The semantic colour roles the product paints with, in the order they are written out. */
const ROLE_GROUPS = ['surface', 'fg', 'line', 'accent', 'brand', 'admin', 'danger', 'warning', 'success', 'info'];
export const FEEDBACK = ['danger', 'warning', 'success', 'info'];

/**
 * Fold the light and dark dictionaries into one model.
 * @param {import('style-dictionary').TransformedToken[]} light
 * @param {import('style-dictionary').TransformedToken[]} dark
 */
export function buildModel(light, dark) {
  const darkByPath = byPath(dark);
  const value = (t) => t.$value ?? t.value;
  const pick = (prefix) => light.filter((t) => t.path.slice(0, prefix.length).join('.') === prefix.join('.'));

  // Primitive ramps: color.<hue>.<step>, excluding the semantic groups.
  const semanticRoots = new Set([...ROLE_GROUPS, 'type', 'relation']);
  const palette = {};
  for (const t of pick(['color'])) {
    const [, hue, step] = t.path;
    if (semanticRoots.has(hue) || t.path.length > 3) continue;
    if (step === undefined) palette[hue] = value(t);
    else (palette[hue] ??= {})[step] = value(t);
  }

  // Semantic roles — each with its light and dark value.
  const roles = [];
  for (const group of ROLE_GROUPS) {
    for (const t of pick(['color', group])) {
      const d = darkByPath.get(t.path.join('.'));
      roles.push({
        path: t.path,
        name: roleSegments(t.path.slice(1)),
        light: value(t),
        dark: d ? value(d) : value(t),
        description: t.$description ?? t.comment,
      });
    }
  }

  // Types: default (theme-agnostic) + fg/wash per theme.
  const typeNames = [...new Set(pick(['color', 'type']).map((t) => t.path[2]))];
  const types = typeNames.map((name) => {
    const at = (leaf, tokens) => value(byPath(tokens).get(['color', 'type', name, leaf].join('.')));
    return {
      name,
      light: { default: at('default', light), fg: at('fg', light), wash: at('wash', light) },
      dark: { default: at('default', dark), fg: at('fg', dark), wash: at('wash', dark) },
    };
  });

  const relations = pick(['color', 'relation']).map((t) => ({ name: t.path[2], value: value(t) }));

  const accentIds = [...new Set(pick(['accents']).map((t) => t.path[1]))];
  const accents = accentIds.map((id) => {
    const at = (mode, leaf) => value(byPath(light).get(['accents', id, mode, leaf].join('.')));
    return {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      light: { default: at('light', 'default'), strong: at('light', 'strong'), soft: at('light', 'soft') },
      dark: { default: at('dark', 'default'), strong: at('dark', 'strong'), soft: at('dark', 'soft') },
    };
  });

  const scale = (prefix, read = num) =>
    pick(prefix).map((t) => ({ key: t.path.at(-1), value: read(value(t)), description: t.$description }));

  return {
    palette,
    roles,
    types,
    relations,
    accents,
    // JSON puts integer-like keys first (`px`, `0-5` would trail); spacing reads best in size order.
    space: scale(['space']).sort((a, b) => a.value - b.value),
    radius: scale(['radius']),
    fontSize: scale(['font', 'size']),
    fontWeight: scale(['font', 'weight'], Number),
    fontFamily: scale(['font', 'family'], (v) => v),
    shadow: scale(['shadow'], (v) => v),
    duration: scale(['motion', 'duration']),
    ease: scale(['motion', 'ease'], (v) => v),
    z: scale(['z'], Number),
    breakpoint: scale(['breakpoint']),
  };
}

// ── Shared writers ──────────────────────────────────────────────────────────

export const HEADER_LINES = [
  'Generated by packages/tokens from its DTCG source. Do not edit.',
  'Change a token in packages/tokens/tokens/, then run `pnpm tokens:build`.',
];

export function shadowCss(layers) {
  return layers.map((l) => `${l.offsetX} ${l.offsetY} ${l.blur} ${l.spread} ${l.color}`).join(', ');
}

export function cubicBezierCss(points) {
  return `cubic-bezier(${points.join(', ')})`;
}

/** A px value as rem, the way Tailwind writes its own scale (so a browser's font-size setting still scales it). */
export function rem(px) {
  return px === 0 ? '0' : `${+(px / 16).toFixed(4)}rem`;
}
