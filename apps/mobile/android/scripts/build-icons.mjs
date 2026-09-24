/**
 * Android icon codegen — `assets/icons/*.svg` → `res/drawable/ic_<name>.xml`.
 *
 * The repo-root SVG directory is the source of truth for all three clients (see
 * docs/icons.md). This turns the subset Android actually uses into Android
 * vector drawables, which is the only vector format the platform draws natively.
 *
 * Run from apps/mobile/android:
 *
 *   node scripts/build-icons.mjs           regenerate
 *   node scripts/build-icons.mjs --check   fail if the committed output is stale
 *
 * Only the glyphs named in ANDROID_ICONS are converted, deliberately: an APK
 * should not carry 146 drawables to use thirty of them. Adding a call site means
 * adding its name here and re-running.
 *
 * Two things about the conversion are worth knowing. Android's `pathData` takes
 * the same grammar as SVG's `d`, so paths pass through unchanged — but Android
 * has no `<circle>`/`<rect>`/`<line>`, so those are converted to paths here.
 *
 * And the drawables carry NO `android:tint`. The obvious thing to write is
 * `android:tint="?attr/colorControlNormal"`, and it does not build: this app's
 * theme is a pure Compose Material3 one with no AppCompat attributes, so that
 * reference does not resolve and aapt fails every drawable at once. Colour comes
 * from the call site instead — the drawable declares black strokes and
 * `Icon(painter, tint = ...)` replaces them, which is how `AppIcons` keeps
 * following the theme.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVG_DIR = path.resolve(HERE, '../../../../assets/icons');
const OUT_DIR = path.resolve(HERE, '../app/src/main/res/drawable');

/** The glyphs the Android app draws. Keep in step with AppIcons.kt. */
export const ANDROID_ICONS = [
  'arrow-down',
  'arrow-left',
  'arrow-up',
  'bell',
  'calendar',
  'check',
  'chevron-down',
  'chevron-right',
  'circle-check',
  'circle-question-mark',
  'clock',
  'earth',
  'external-link',
  'hammer',
  'lock',
  'log-out',
  'mail',
  'map-pin',
  'message-circle',
  'palette',
  'pencil',
  'search',
  'settings',
  'square',
  'square-check',
  'tag',
  'user',
  'user-plus',
  'users',
  'waypoints',
  'bot',
  'house',
  'mic',
  'plus',
  'send',
  'sparkles',
  'x',
  // Resources: one glyph per file kind (packages/ui/src/resources/fileKinds.tsx) and the viewer's actions.
  'file',
  'file-image',
  'file-play',
  'file-music',
  'file-pdf',
  'file-spreadsheet',
  'presentation',
  'file-code-2',
  'file-archive',
  'download',
  'share',
  'link-2',
  'file-text',
];

/** Serialise a number the way Android's vector parser likes it. */
const n = (v) => String(Number(v));

/**
 * SVG shape → path data.
 *
 * Android vector drawables only understand `<path>`, so the basic shapes are
 * expanded here rather than at runtime. Circles and rounded rects are drawn as
 * arc pairs because a single arc cannot close a full ellipse in path grammar.
 */
function shapeToPath(tag, a) {
  switch (tag) {
    case 'path':
      return a.d;
    case 'line':
      return `M${n(a.x1)},${n(a.y1)} L${n(a.x2)},${n(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const points = a.points.trim().split(/[\s,]+/);
      const pairs = [];
      for (let i = 0; i < points.length; i += 2) pairs.push(`${n(points[i])},${n(points[i + 1])}`);
      return `M${pairs.join(' L')}${tag === 'polygon' ? ' Z' : ''}`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = Number(a.cx);
      const cy = Number(a.cy);
      const rx = Number(a.rx ?? a.r);
      const ry = Number(a.ry ?? a.r);
      return (
        `M${n(cx - rx)},${n(cy)} ` +
        `a${n(rx)},${n(ry)} 0 1,0 ${n(rx * 2)},0 ` +
        `a${n(rx)},${n(ry)} 0 1,0 ${n(-rx * 2)},0 Z`
      );
    }
    case 'rect': {
      const x = Number(a.x ?? 0);
      const y = Number(a.y ?? 0);
      const w = Number(a.width);
      const h = Number(a.height);
      const r = Math.min(Number(a.rx ?? a.ry ?? 0), w / 2, h / 2);
      if (!r) return `M${n(x)},${n(y)} h${n(w)} v${n(h)} h${n(-w)} Z`;
      return (
        `M${n(x + r)},${n(y)} h${n(w - 2 * r)} a${n(r)},${n(r)} 0 0,1 ${n(r)},${n(r)} ` +
        `v${n(h - 2 * r)} a${n(r)},${n(r)} 0 0,1 ${n(-r)},${n(r)} ` +
        `h${n(-(w - 2 * r))} a${n(r)},${n(r)} 0 0,1 ${n(-r)},${n(-r)} ` +
        `v${n(-(h - 2 * r))} a${n(r)},${n(r)} 0 0,1 ${n(r)},${n(-r)} Z`
      );
    }
    default:
      throw new Error(`unsupported element <${tag}>`);
  }
}

function attrsOf(tagSource) {
  const attrs = {};
  const re = /([-A-Za-z0-9_:]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tagSource))) attrs[m[1]] = m[2];
  return attrs;
}

async function drawableFor(name) {
  const raw = await fs.readFile(path.join(SVG_DIR, `${name}.svg`), 'utf8');
  const root = attrsOf(raw.match(/<svg\b([\s\S]*?)>/)[1]);
  const strokeWidth = root['stroke-width'] ?? '2';

  const paths = [];
  for (const m of raw.matchAll(/<([a-z]+)\b([^>]*?)\/>/g)) {
    const tag = m[1];
    if (tag === 'svg') continue;
    const a = attrsOf(m[2]);
    paths.push(
      [
        '    <path',
        `        android:pathData="${shapeToPath(tag, a).replace(/"/g, '&quot;')}"`,
        '        android:strokeColor="#000000"',
        `        android:strokeWidth="${a['stroke-width'] ?? strokeWidth}"`,
        '        android:strokeLineCap="round"',
        '        android:strokeLineJoin="round" />',
      ].join('\n'),
    );
  }
  if (!paths.length) throw new Error(`${name}.svg produced no paths`);

  return [
    '<!-- AUTO-GENERATED by scripts/build-icons.mjs from assets/icons/' + name + '.svg — do not edit. -->',
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="24dp"',
    '    android:height="24dp"',
    '    android:viewportWidth="24"',
    '    android:viewportHeight="24">',
    paths.join('\n'),
    '</vector>',
    '',
  ].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const stale = [];

  for (const name of ANDROID_ICONS) {
    const xml = await drawableFor(name);
    const file = path.join(OUT_DIR, `ic_${name.replace(/-/g, '_')}.xml`);
    if (check) {
      const got = await fs.readFile(file, 'utf8').catch(() => null);
      if (got !== xml) stale.push(path.basename(file));
    } else {
      await fs.mkdir(OUT_DIR, { recursive: true });
      await fs.writeFile(file, xml);
    }
  }

  if (check) {
    if (stale.length) {
      console.error(`icons: stale drawables (${stale.join(', ')}). Run \`node scripts/build-icons.mjs\`.`);
      process.exit(1);
    }
    console.log(`icons: ${ANDROID_ICONS.length} drawables up to date.`);
    return;
  }
  console.log(`icons: wrote ${ANDROID_ICONS.length} drawables to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
