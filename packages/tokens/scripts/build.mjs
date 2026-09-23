#!/usr/bin/env node
// Regenerates every platform's tokens from the DTCG source in tokens/.
//
//   pnpm tokens:build   write every output
//   pnpm tokens:check   write nothing; fail if any output is stale (CI)
//
// Style Dictionary parses the source and resolves every reference, once per
// theme. Each platform's files are formatted in memory first, so the check and
// the build run the same code and differ only in whether they write.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import StyleDictionary from 'style-dictionary';
import { buildModel } from '../sd/model.mjs';
import { tokensCss, themeCss } from '../sd/formats/css.mjs';
import { indexTs } from '../sd/formats/ts.mjs';
import { swift, kotlin } from '../sd/formats/native.mjs';
import { desktopTs, offlineHtml } from '../sd/formats/desktop.mjs';
import { accentColorset, androidColors } from '../sd/formats/resources.mjs';
import { syncAssets } from './assets.mjs';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(pkg, '../..');
const check = process.argv.includes('--check');

const sources = (theme) => [
  path.join(pkg, 'tokens/primitive/*.json'),
  path.join(pkg, 'tokens/semantic/base.json'),
  path.join(pkg, 'tokens/semantic/accents.json'),
  path.join(pkg, `tokens/semantic/${theme}.json`),
];

async function resolve(theme) {
  const sd = new StyleDictionary(
    { source: sources(theme), platforms: { resolved: { transforms: ['name/kebab'] } }, log: { verbosity: 'silent' } },
    { warnings: 'error' },
  );
  return (await sd.getPlatformTokens('resolved')).allTokens;
}

const dark = await resolve('dark');

// Every output, keyed by its path in the repo. One format per file, all reading
// the same model; `current` is the file as it stands, for the one output
// (offline.html) that is a block inside a file the shell otherwise owns.
const OUTPUTS = {
  'packages/tokens/generated/tokens.css': (m) => tokensCss(m),
  'packages/tokens/generated/theme.css': (m) => themeCss(m),
  'packages/tokens/generated/index.ts': (m) => indexTs(m),
  'apps/desktop/src/tokens.generated.ts': (m) => desktopTs(m),
  'apps/desktop/resources/offline.html': (m, current) => offlineHtml(m, current),
  'apps/mobile/ios/Visvine/Theme/Tokens.generated.swift': (m) => swift(m),
  'apps/mobile/ios/Visvine/Assets.xcassets/AccentColor.colorset/Contents.json': (m) => accentColorset(m),
  'apps/mobile/android/app/src/main/java/com/visvine/mobile/ui/theme/Tokens.kt': (m) =>
    kotlin(m, { packageName: 'com.visvine.mobile.ui.theme' }),
  'apps/mobile/android/app/src/main/res/values/tokens.xml': (m) => androidColors(m),
};

const formats = Object.fromEntries(
  Object.entries(OUTPUTS).map(([dest, render]) => [
    dest,
    ({ dictionary }) => {
      const current = fs.existsSync(path.join(repo, dest)) ? fs.readFileSync(path.join(repo, dest), 'utf8') : '';
      return render(buildModel(dictionary.allTokens, dark), current);
    },
  ]),
);

const sd = new StyleDictionary(
  {
    source: sources('light'),
    hooks: { formats },
    log: { verbosity: 'silent' },
    platforms: {
      all: {
        transforms: ['name/kebab'],
        buildPath: `${repo}/`,
        files: Object.keys(OUTPUTS).map((dest) => ({ destination: dest, format: dest })),
      },
    },
  },
  { warnings: 'error' },
);

const stale = [];
for (const { output, destination } of await sd.formatPlatform('all')) {
  const rel = path.relative(repo, destination);
  const before = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : null;
  if (before === output) continue;
  if (check) stale.push(rel);
  else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, output);
    console.log(`  wrote ${rel}`);
  }
}

stale.push(...syncAssets({ repo, pkg, check }));

if (check && stale.length) {
  console.error(`Tokens are stale — run \`pnpm tokens:build\`:\n${stale.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(check ? 'Tokens are current.' : 'Tokens built.');
