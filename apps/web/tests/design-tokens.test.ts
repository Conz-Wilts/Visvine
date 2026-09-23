/**
 * The web app paints with the design tokens (packages/tokens) and nothing else.
 *
 * The failure this guards is quiet: a raw `text-red-600` or a `#6b7280` renders
 * fine, passes every typecheck, and is one more value the next palette change
 * misses on one platform. So the source is scanned for the three ways a colour
 * gets in without a token — a Tailwind palette class, a pre-token utility name,
 * and a hex literal.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/design-tokens.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// tsx compiles this to CJS, so `__dirname` is what resolves here.
const WEB = path.join(__dirname, '..')
const ROOTS = ['app', 'components', 'features', 'lib']

/**
 * Files that carry colours on purpose. The Tool kit and its bridge keep the
 * names installed Tools were built against; the rest are not the product's
 * palette (another brand's logo, a hue picker's rainbow, docs quoting CSS).
 */
const ALLOWED = [
  'features/tools/kit/',
  'features/tools/lib/theme.ts',
  'lib/tools/protocol.ts',
  'lib/tools/sdkDocs.ts',
  'lib/tools/compile.ts',
  'features/auth/components/SignInCard.tsx', // Google's own four colours
  'features/admin/components/ColorPicker.tsx', // the hue slider's rainbow
]

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'generated') walk(full)
      } else if (/\.(tsx?|css)$/.test(entry.name)) {
        out.push(path.relative(WEB, full))
      }
    }
  }
  ROOTS.forEach((r) => walk(path.join(WEB, r)))
  return out.filter((f) => !ALLOWED.some((a) => f === a || f.startsWith(a)))
}

/** Code only: comments may name a colour to explain one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function offenders(pattern: RegExp, skip: (before: string) => boolean = () => false): string[] {
  const found: string[] = []
  for (const file of sourceFiles()) {
    const code = stripComments(readFileSync(path.join(WEB, file), 'utf8'))
    for (const m of code.matchAll(pattern)) {
      if (!skip(code.slice(Math.max(0, m.index - 12), m.index))) found.push(`${file}: ${m[0]}`)
    }
  }
  return found
}

const UTILITY =
  'bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|outline|divide|from|via|to|fill|stroke|decoration|accent|caret|placeholder|shadow'

test('no raw Tailwind palette class — status is danger/warning/success/info, kinds are hue-*', () => {
  const palette = new RegExp(
    `(?<![\\w-])(?:${UTILITY})-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?![\\w-])`,
    'g',
  )
  assert.deepEqual(offenders(palette), [])
})

test('no pre-token colour name survives (surface-1, text-text-muted, brand-green…)', () => {
  const legacy = new RegExp(
    `(?<![\\w-])(?:${UTILITY})-(?:surface-[123]|border-(?:subtle|default)|text-(?:primary|secondary|muted|tertiary)|brand-(?:green|dark-green|light-bg|black|grey|white|bg|gold))(?![\\w-])` +
      '|var\\(--(?:color-(?:surface-[123]|border-|text-|brand-|link|danger)|surface-[123]|border-(?:subtle|default)|text-(?:primary|secondary|muted)|app-backdrop|theme-accent-color|shell-)',
    'g',
  )
  assert.deepEqual(offenders(legacy), [])
})

test('no hex colour literal — reach for a token (`color`, `palette` or a --vv-* property)', () => {
  // A hex in a string or CSS value; `#123` issue refs and `#root` selectors are not colours.
  const hex = /(?<=['"`\s(:,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g
  // Prose telling a person or a model what a hex looks like ("a hex like #3b82f6") is not paint.
  const example = (before: string) => /(like|e\.g\.)\s*['"]?$/.test(before)
  assert.deepEqual(offenders(hex, example), [])
})
