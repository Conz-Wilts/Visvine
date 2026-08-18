/**
 * The icon set's invariants.
 *
 * Icons are files we own (assets/icons/*.svg) codegen'd into components, and
 * the failure mode that matters is drift: a glyph renamed without its callers,
 * a generated file hand-edited, a Tool rail name pointing at a shape that no
 * longer exists. Each of those is a hole in the chrome at runtime and a passing
 * typecheck beforehand, so they get asserted here instead.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/icons.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { ICON_NAMES, isIconName } from '@/lib/icons/names'
import { TOOL_RAIL_ICONS } from '@/lib/tools/config'
import { CHANNEL_ICONS } from '@/features/messages/components/ChannelIcon'

// tsx compiles this to CJS, so `import.meta.dirname` is undefined — `__dirname`
// is what actually resolves here (same note as tests/delete-account.test.ts).
const WEB = path.join(__dirname, '..')
const SVG_DIR = path.resolve(WEB, '../../assets/icons')

function svgFiles(): string[] {
  return readdirSync(SVG_DIR)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => path.basename(f, '.svg'))
    .sort()
}

test('every SVG has a name, and every name has an SVG', () => {
  assert.deepEqual([...ICON_NAMES].sort(), svgFiles())
})

test('names are kebab-case, so the generated component names are predictable', () => {
  for (const name of ICON_NAMES) {
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${name} is not kebab-case`)
  }
})

test('isIconName accepts what we ship and refuses what we do not', () => {
  assert.equal(isIconName('check'), true)
  assert.equal(isIconName('definitely-not-an-icon'), false)
  // The guard exists to gate DATA, so the non-string cases matter.
  assert.equal(isIconName(null), false)
  assert.equal(isIconName(undefined), false)
  assert.equal(isIconName(42), false)
  // Not a way to reach Object.prototype.
  assert.equal(isIconName('toString'), false)
  assert.equal(isIconName('constructor'), false)
})

test('every SVG is drawn to the house spec', () => {
  for (const name of svgFiles()) {
    const svg = readFileSync(path.join(SVG_DIR, `${name}.svg`), 'utf8')
    assert.match(svg, /viewBox="0 0 24 24"/, `${name}.svg must be a 24x24 canvas`)
    assert.match(svg, /stroke="currentColor"/, `${name}.svg must inherit its colour`)
    assert.match(svg, /stroke-width="[\d.]+"/, `${name}.svg must declare a stroke weight`)
    // A hardcoded colour is the one thing that breaks in dark mode and nowhere
    // else, so it is worth catching before anybody sees it.
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b/, `${name}.svg must not hardcode a colour`)
    assert.doesNotMatch(svg, /<script|foreignObject|xlink:href/i, `${name}.svg has no business doing that`)
  }
})

test('every Tool rail icon name resolves to a glyph we own', async () => {
  // The rail names are a published contract (a Tool's frontmatter refers to
  // them), mapped onto icon files in features/tools/components/toolIcons.tsx.
  // A rename on either side is a hole in the sidebar, which this catches.
  const source = readFileSync(
    path.join(WEB, 'features/tools/components/toolIcons.tsx'),
    'utf8',
  )
  for (const rail of TOOL_RAIL_ICONS) {
    const mapped = new RegExp(`^\\s*${rail}: '([a-z0-9-]+)',`, 'm').exec(source)
    assert.ok(mapped, `TOOL_RAIL_ICONS has "${rail}" but toolIcons.tsx does not map it`)
    assert.ok(isIconName(mapped[1]), `rail icon "${rail}" maps to "${mapped[1]}", which we do not own`)
  }
})

test('every channel icon in the picker is one we own', () => {
  for (const name of CHANNEL_ICONS) {
    assert.ok(isIconName(name), `the channel picker offers "${name}", which we do not own`)
  }
})

test('the committed generated output matches the SVGs', () => {
  // The generator writes three files that must never be hand-edited. `--check`
  // regenerates in memory and exits non-zero on any difference; `lint` runs the
  // same command, so this is really asserting that check still works.
  execFileSync(
    process.execPath,
    ['--import', 'tsx', path.join(WEB, 'scripts/build-icons.ts'), '--check'],
    { stdio: 'pipe' },
  )
})
