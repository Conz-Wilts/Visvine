/**
 * iOS icon codegen — `assets/icons/*.svg` → `Assets.xcassets/Icons/<name>.imageset`.
 *
 * The repo-root SVG directory is the source of truth for all three clients (see
 * docs/icons.md). Xcode has rendered SVG image sets natively since Xcode 12, so
 * unlike Android there is no conversion to do: each glyph is copied in as-is
 * beside a `Contents.json` that marks it a **template** image, which is what lets
 * SwiftUI's `.foregroundStyle` tint it the way it tints an SF Symbol.
 *
 * Run from apps/mobile/ios:
 *
 *   node scripts/build-icons.mjs           regenerate
 *   node scripts/build-icons.mjs --check   fail if the committed output is stale
 *
 * Only the glyphs named in IOS_ICONS are copied — an app bundle should not carry
 * 146 assets to draw fifteen. Adding a call site means adding its name here,
 * re-running, and adding the case to `VisvineIcon`.
 *
 * One thing the SVGs need for this to work: a `width`/`height` on the root. The
 * shared files carry only a `viewBox` (deliberately — on the web the size comes
 * from CSS), and Xcode's SVG renderer wants intrinsic dimensions. They are added
 * here rather than in the shared file, so the web keeps its behaviour.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVG_DIR = path.resolve(HERE, '../../../../assets/icons');
const OUT_DIR = path.resolve(HERE, '../Visvine/Assets.xcassets/Icons');

/** The glyphs the iOS app draws. Keep in step with VisvineIcon.swift. */
export const IOS_ICONS = [
  'arrow-down',
  'arrow-up',
  'bell',
  'calendar',
  'check',
  'chevron-down',
  'chevron-right',
  'circle-check',
  'circle-question-mark',
  'clock',
  'compass',
  'globe',
  'hammer',
  'link-2',
  'lock',
  'log-out',
  'mail',
  'map-pin',
  'message-circle',
  'palette',
  'pencil',
  'phone',
  'search',
  'settings',
  'square',
  'square-check',
  'tag',
  'user',
  'users',
  'waypoints',
  'arrow-left',
  'bot',
  'house',
  'mic',
  'plus',
  'send',
  'sparkles',
  'user-plus',
  'x',
  'file-text',
  'folder',
  'folder-open',
  'tool-grid',
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
  'external-link',
];

const CONTENTS_JSON = (file) =>
  JSON.stringify(
    {
      images: [{ filename: file, idiom: 'universal' }],
      info: { author: 'xcode', version: 1 },
      properties: {
        // Draw the vector at whatever size it is asked for, rather than
        // rasterising it once at 1x.
        'preserves-vector-representation': true,
        // The tint comes from the call site, exactly as with an SF Symbol.
        'template-rendering-intent': 'template',
      },
    },
    null,
    2,
  ) + '\n';

/** Xcode needs intrinsic dimensions; the shared SVGs only carry a viewBox. */
function sized(svg) {
  return svg.replace(/<svg\b/, '<svg width="24" height="24"');
}

/** The `Icons` folder's own Contents.json — marks it a namespaced group. */
const GROUP_JSON =
  JSON.stringify(
    { info: { author: 'xcode', version: 1 }, properties: { 'provides-namespace': false } },
    null,
    2,
  ) + '\n';

async function main() {
  const check = process.argv.includes('--check');
  const stale = [];

  /** Write, or record a difference when checking. */
  async function put(file, contents) {
    if (check) {
      const got = await fs.readFile(file, 'utf8').catch(() => null);
      if (got !== contents) stale.push(path.relative(OUT_DIR, file));
      return;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
  }

  await put(path.join(OUT_DIR, 'Contents.json'), GROUP_JSON);

  for (const name of IOS_ICONS) {
    const svg = await fs.readFile(path.join(SVG_DIR, `${name}.svg`), 'utf8');
    const set = path.join(OUT_DIR, `${name}.imageset`);
    await put(path.join(set, `${name}.svg`), sized(svg));
    await put(path.join(set, 'Contents.json'), CONTENTS_JSON(`${name}.svg`));
  }

  if (check) {
    if (stale.length) {
      console.error(`icons: stale image sets (${stale.join(', ')}). Run \`node scripts/build-icons.mjs\`.`);
      process.exit(1);
    }
    console.log(`icons: ${IOS_ICONS.length} image sets up to date.`);
    return;
  }
  console.log(`icons: wrote ${IOS_ICONS.length} image sets to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
