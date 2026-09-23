// Builds the Visvine Design System artifact's files (claude.ai, the "Design
// System" type) from the verified design-sync bundle and the repo's own
// sources. Run from packages/ui after the design-sync driver has built
// ./ds-bundle:
//
//   node .design-sync/artifact/build.mjs
//
// Writes .design-sync/.cache/artifact/project/** (the files to publish) and
// .design-sync/.cache/artifact/upload/** (the logos and icons, uploaded to the
// artifact's asset store). The index (project/design-system.json) is written
// only once .design-sync/artifact/assets.json records the uploads' ids.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const HERE = dirname(new URL(import.meta.url).pathname)
const PKG = join(HERE, '..', '..')
const REPO = join(PKG, '..', '..')
const LEGACY = join(PKG, 'ds-bundle')
const OUT = join(PKG, '.design-sync', '.cache', 'artifact')
const PROJECT = join(OUT, 'project')
const UPLOAD = join(OUT, 'upload')
const NAMESPACE = 'VisvineUI'

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
if (!existsSync(join(LEGACY, '_ds_bundle.js'))) fail('ds-bundle/ is missing — run the design-sync driver first')

const read = (p) => readFileSync(p, 'utf8')
const write = (rel, text) => { const p = join(PROJECT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text) }
const json = (v) => JSON.stringify(v, null, 2) + '\n'

rmSync(OUT, { recursive: true, force: true })
mkdirSync(PROJECT, { recursive: true })

const components = JSON.parse(read(join(HERE, 'components.json')))
const names = Object.keys(components)

// ── tokens.json ─────────────────────────────────────────────────────────────
// The light :root block of packages/tokens' generated CSS, named exactly as
// the CSS variables the bundle's stylesheet reads (minus the leading --).
const tokensCss = read(join(REPO, 'packages/tokens/generated/tokens.css'))
const rootBlock = tokensCss.slice(tokensCss.indexOf(':root {'), tokensCss.indexOf('}', tokensCss.indexOf(':root {')))
const vars = [...rootBlock.matchAll(/^\s*--(vv-[a-z0-9-]+):\s*([^;]+);/gm)].map(([, name, value]) => ({ name, value: value.trim() }))

const ROLE_USAGE = {
  'vv-color-surface': 'Page and panel ground. Body text (`vv-color-fg`) reads on it.',
  'vv-color-surface-subtle': 'A faint fill: inputs at rest, neutral buttons, quiet panels.',
  'vv-color-surface-muted': 'Hover and selected rows, the neutral button\'s hover, skeletons, the toggle\'s off track.',
  'vv-color-surface-backdrop': 'The page backdrop behind the shell; pinned chrome paints it to hide what scrolls beneath.',
  'vv-color-surface-glass': 'Translucent white under a 16px blur, for chrome that slides in over content.',
  'vv-color-fg': 'Primary ink: body copy and headings on `vv-color-surface`.',
  'vv-color-fg-secondary': 'Secondary ink: supporting text, neutral and ghost button labels.',
  'vv-color-fg-muted': 'Muted metadata, state lines joined by ·, placeholders, icons at rest.',
  'vv-color-fg-subtle': 'Disabled text and the faintest hints; not for anything that must be read.',
  'vv-color-fg-inverse': 'Ink on a filled accent, brand or danger ground.',
  'vv-color-fg-link': 'Inline links in prose.',
  'vv-color-line': 'Control borders (select, checkbox) and stronger dividers.',
  'vv-color-line-subtle': 'Hairlines between sections and rows; the default divider.',
  'vv-color-accent': 'The hue a person picks (default the logo green): primary buttons, selection, the tab underline, focus rings.',
  'vv-color-accent-strong': 'Accent-coloured text and the accent\'s pressed state; reads on white and on `vv-color-accent-soft`.',
  'vv-color-accent-soft': 'A wash of the accent behind selected items.',
  'vv-color-brand': 'The logo green. Fixed: never follows the chosen accent. For the logo and the wordmark only.',
  'vv-color-admin': 'The Admin alias chip and admin-only marks.',
}
const STATUS_SHADE = {
  '': 'text and icons for this status on white',
  strong: 'hover or pressed state; text on its wash',
  bright: 'a mark or a 2px rule in this status',
  wash: 'the tinted ground behind a notice',
  line: 'the border of a notice',
}
function colorUsage(name) {
  if (ROLE_USAGE[name]) return ROLE_USAGE[name]
  let m = /^vv-color-(danger|warning|success|info)(?:-(strong|bright|wash|line))?$/.exec(name)
  if (m) return `${m[1][0].toUpperCase() + m[1].slice(1)} status: ${STATUS_SHADE[m[2] ?? '']}. Carries meaning; never used to tell kinds apart.`
  m = /^vv-color-hue-([a-z]+)(?:-(fg|wash|line))?$/.exec(name)
  if (m) {
    const role = { undefined: 'the solid fill', fg: 'text on its wash', wash: 'a tinted ground', line: 'its border' }[m[2]]
    return `Categorical ${m[1]}: ${role}. Tells kinds of a thing apart (file types, HTTP methods); never status.`
  }
  m = /^vv-color-type-([a-z]+)(?:-(fg|wash))?$/.exec(name)
  if (m) {
    const role = { undefined: 'its chip and avatar fill', fg: 'text on its wash', wash: 'a tinted ground' }[m[2]]
    return `Default colour of the ${m[1]} node type: ${role}. A space may override it.`
  }
  return null
}

const colorTokens = []
const spacing = [], radius = [], shadow = [], zIndex = []
const skipped = []
for (const { name, value } of vars) {
  if (name.startsWith('vv-color-')) {
    const usage = colorUsage(name)
    if (!usage) { skipped.push(name); continue }
    colorTokens.push({ name, value: { light: value.toLowerCase() }, usage })
  } else if (name.startsWith('vv-space-')) {
    const step = name.slice('vv-space-'.length).replace('-', '.')
    spacing.push({ name, value, usage: step === 'px' ? 'A 1px hairline offset.' : `Spacing step ${step} (\`p-${step}\`, \`gap-${step}\`).` })
  } else if (name.startsWith('vv-radius-')) {
    const key = name.slice('vv-radius-'.length)
    const use = { none: 'Square corners.', xs: 'Tiny marks.', sm: 'Small controls and ghost buttons (`rounded`).', md: 'Chips (`rounded-md`).', lg: 'Buttons, inputs, selects, small avatars (`rounded-lg`).', xl: 'Dialogs, panels, large avatars (`rounded-xl`).', '2xl': 'Large panels (`rounded-2xl`).', '3xl': 'Hero surfaces (`rounded-3xl`).', full: 'Toggles and dot chips only; never buttons.' }[key]
    radius.push({ name, value, usage: use ?? `Radius ${key}.` })
  } else if (name.startsWith('vv-shadow-')) {
    const use = { float: 'Floating chrome only: menus, popovers, toasts (`shadow-float`).', strip: 'Docked chrome pinned over the page (`shadow-strip`).', lift: 'A dragged item lifted off the page.' }[name.slice('vv-shadow-'.length)]
    shadow.push({ name, value, usage: use })
  } else if (name.startsWith('vv-z-')) {
    zIndex.push({ name, value, usage: `Stacking layer: ${name.slice('vv-z-'.length)}.` })
  } else if (!/^vv-(font|motion)-/.test(name)) {
    skipped.push(name)
  }
}

const fontFaces = [...read(join(LEGACY, 'fonts/fonts.css')).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  family: /font-family:\s*'([^']+)'/.exec(body)[1],
  file: `fonts/${/url\('\.\/([^']+)'\)/.exec(body)[1]}`,
  weight: /font-weight:\s*([^;]+);/.exec(body)[1].trim(),
  style: 'normal',
}))
const stack = (key) => new RegExp(`--vv-font-family-${key}:\\s*([^;]+);`).exec(tokensCss)[1].trim()
const px = (n) => `${n}px`
const ghead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim()

const tokens = {
  name: 'Visvine',
  version: 1,
  meta: {
    source: 'github',
    repo: 'Conz-Wilts/Visvine',
    ref: `main@${ghead}`,
    package: 'packages/ui',
    paths: {
      tokens: ['packages/tokens/generated/tokens.css'],
      fonts: ['packages/tokens/assets/fonts/web'],
      assets: ['packages/tokens/assets/logo', 'assets/icons'],
      docs: ['packages/ui/DESIGN.md', 'AGENTS.md'],
    },
    components: Object.fromEntries(names.map((n) => [n, `packages/ui/src/${n.startsWith('SearchMenu') ? 'SearchMenu' : n === 'ToastHost' ? 'Toast' : n === 'Row' ? 'Stack' : n === 'IconBase' ? 'icons/IconBase' : n}.tsx`])),
    synced: new Date().toISOString().slice(0, 10),
  },
  color: {
    themes: [{ id: 'light', name: 'Light' }],
    note: 'Light is the only theme any app shows. The accent follows the hue a person picks; the default is the logo green.',
    tokens: colorTokens,
  },
  type: {
    fonts: fontFaces,
    families: { ui: stack('ui'), brand: stack('brand') },
    groups: [
      {
        name: 'Text',
        family: 'ui',
        note: 'Open Sauce One. The Tailwind text scale reads these steps.',
        styles: [
          { name: 'text-2xl', fontSize: px(24), lineHeight: '32px', fontWeight: 600, sample: 'Growth team', usage: 'Page titles.' },
          { name: 'text-xl', fontSize: px(20), lineHeight: '28px', fontWeight: 600, sample: 'Connectors', usage: 'Dialog and large section titles.' },
          { name: 'text-lg', fontSize: px(18), lineHeight: '28px', fontWeight: 600, sample: 'Delete account', usage: 'Section headings.' },
          { name: 'text-base', fontSize: px(16), lineHeight: '24px', fontWeight: 400, sample: 'Every weekday at 9am, a summary of what shipped.', usage: 'Inputs and reading text.' },
          { name: 'text-sm', fontSize: px(14), lineHeight: '20px', fontWeight: 400, sample: 'Its stored secrets stay.', usage: 'Body copy, buttons, rows.' },
          { name: 'text-sm-medium', fontSize: px(14), lineHeight: '20px', fontWeight: 500, sample: 'Channels', usage: 'Labels and row titles.' },
          { name: 'text-xs', fontSize: px(12), lineHeight: '16px', fontWeight: 400, sample: 'Runs as Ana · next in 5h', usage: 'Metadata and state lines, in `vv-color-fg-muted`.' },
        ],
      },
      {
        name: 'Brand',
        family: 'brand',
        note: 'ABC Ginto Rounded: the wordmark and marketing pages only, never inside the product.',
        styles: [
          { name: 'wordmark', fontSize: px(48), lineHeight: '48px', fontWeight: 900, sample: 'visvine', usage: 'The wordmark beside the logo, lowercase, in `vv-color-brand`.' },
          { name: 'marketing-display', fontSize: px(60), lineHeight: '60px', fontWeight: 700, sample: 'Know who you know', usage: 'Marketing headlines only.' },
        ],
      },
    ],
  },
  spacing: { tokens: spacing },
  radius: { tokens: radius },
  shadow: { tokens: shadow },
  zIndex: { note: 'Stacking layers for floating chrome.', tokens: zIndex },
}
write('tokens.json', json(tokens))

// ── the brand book and fonts ───────────────────────────────────────────────
write('README.md', read(join(HERE, 'README.md')))
for (const f of fontFaces) cpSync(join(LEGACY, f.file), join(PROJECT, f.file))

// ── components ─────────────────────────────────────────────────────────────
const bundle = read(join(LEGACY, '_ds_bundle.js'))
const body = bundle.slice(bundle.indexOf('\n') + 1)
if (/<\/script|<!--/i.test(body)) fail('bundle.js holds </script or <!--')
write('components/bundle.js', `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: NAMESPACE, components: names.map((name) => ({ name })) })} */\n${body}`)
const css = read(join(LEGACY, '_ds_bundle.css'))
if (/<\/style/i.test(css)) fail('bundle.css holds </style')
write('components/bundle.css', css)
const react = read(join(LEGACY, '_vendor/react.js'))
if (/<\/script|<!--/i.test(react)) fail('react.js holds </script or <!--')
write('components/lib/react.js', react)
write('components/lib/react-dom.js', '/* ReactDOM 19.2.8 ships inside react.js, which sets window.ReactDOM. */\n')

const legacyDir = (name) => {
  for (const g of readdirSync(join(LEGACY, 'components'))) if (existsSync(join(LEGACY, 'components', g, name))) return join(LEGACY, 'components', g, name)
  fail(`no legacy card for ${name}`)
}
const dts = ['import * as React from \'react\';', '']
for (const name of names) {
  const d = read(join(legacyDir(name), `${name}.d.ts`)).replace(/^import \* as React from 'react';\n+/m, '')
  dts.push(d.trim(), '')
}
write('components/index.d.ts', dts.join('\n'))

// DESIGN.md's component table, one row per name it lists.
const designRows = {}
for (const line of read(join(PKG, 'DESIGN.md')).split('\n')) {
  if (!line.startsWith('| `')) continue
  const cells = line.split('|').slice(1, -1).map((c) => c.trim())
  const listed = [...cells[0].matchAll(/`([A-Za-z*]+)`/g)].map((m) => m[1])
  for (const n of names) if (listed.some((l) => l === n || (l.endsWith('*') && n.startsWith(l.slice(0, -1))))) designRows[n] = cells
}

const STORY_STYLE = 'body{margin:0;padding:20px 24px;background:var(--vv-color-surface);color:var(--vv-color-fg);font-family:var(--vv-font-family-ui)}.s+.s{margin-top:24px}.s>h4{margin:0 0 10px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--vv-color-fg-muted)}'
for (const name of names) {
  const meta = components[name]
  const dir = legacyDir(name)
  const prompt = read(join(dir, `${name}.prompt.md`))
  const rest = prompt.slice(prompt.indexOf('\n') + 1).trim()
  const row = designRows[name]
  const spec = row
    ? [row[1] !== '—' && `**Variants:** ${row[1]}`, row[2] !== '—' && `**Sizes:** ${row[2]}`, row[3] !== '—' && `**States and notes:** ${row[3]}`].filter(Boolean).join(' · ')
    : ''
  write(`components/${name}/README.md`, [`# ${name}`, '', meta.summary, '', spec, spec ? '' : null, rest, ''].filter((l) => l !== null).join('\n'))

  const previewJs = read(join(LEGACY, '_preview', `${name}.js`))
  if (/<\/script|<!--/i.test(previewJs)) fail(`_preview/${name}.js holds </script or <!--`)
  const stories = [...previewJs.matchAll(/\b([A-Z][A-Za-z0-9]*): \(\) => \1\b/g)].map((m) => m[1])
  const height = meta.height ?? Math.min(4000, Math.max(120, stories.length * 150 + 40))
  const mount = `
;(function () {
  var h = React.createElement, P = typeof __dsPreview !== 'undefined' ? __dsPreview : {}, root = document.getElementById('root')
  var E = Object.keys(P).filter(function (k) { return /^[A-Z]/.test(k) && typeof P[k] === 'function' })
  if (${meta.single ? 'true' : 'false'}) { document.body.style.padding = '0'; ReactDOM.createRoot(root).render(h(P[E[0]])); return }
  E.forEach(function (k, i) {
    var s = document.createElement('section'); s.className = 's'
    s.innerHTML = '<h4></h4><div></div>'; s.firstChild.textContent = k.replace(/([a-z])([A-Z])/g, '$1 $2')
    root.appendChild(s); ReactDOM.createRoot(s.lastChild).render(h(P[k]))
  })
})()`
  write(`components/${name}/preview.html`, [
    `<!-- @dsCard group="${meta.group}" height=${height} -->`,
    '<!doctype html>',
    '<html>',
    `<head><meta charset="utf-8"><title>${name} — preview</title><style>${STORY_STYLE}</style></head>`,
    '<body>',
    '<div id="root"></div>',
    `<script>\n${previewJs}\n${mount}\n</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n'))
}
write('components/Cover/preview.html', read(join(HERE, 'cover.html')))

// ── assets ─────────────────────────────────────────────────────────────────
// Text files go with the project; binaries (and SVGs) are uploads.
write('assets/Logos/README.md', read(join(HERE, 'logos.md')))
write('assets/Icons/README.md', read(join(HERE, 'icons.md')))
write('assets/Icons/ATTRIBUTION.md', read(join(REPO, 'assets/icons/ATTRIBUTION.md')))
mkdirSync(join(UPLOAD, 'Logos'), { recursive: true })
mkdirSync(join(UPLOAD, 'Icons'), { recursive: true })
const LOGOS = ['brand-icon.png', 'ios-logo.png', 'ios-app-icon.png']
for (const f of LOGOS) cpSync(join(REPO, 'packages/tokens/assets/logo', f), join(UPLOAD, 'Logos', f))
for (const f of ['visvine-mark.svg', 'visvine-tile.svg']) cpSync(join(HERE, f), join(UPLOAD, 'Logos', f))
const icons = readdirSync(join(REPO, 'assets/icons')).filter((f) => f.endsWith('.svg')).sort()
for (const f of icons) cpSync(join(REPO, 'assets/icons', f), join(UPLOAD, 'Icons', f))

// ── the index ──────────────────────────────────────────────────────────────
const assetsPath = join(HERE, 'assets.json')
if (!existsSync(assetsPath)) {
  console.log(`✓ project/ written (${names.length} components, ${colorTokens.length} colours); upload/ staged — record uploads in assets.json, then re-run for the index`)
  if (skipped.length) console.log(`  not placed: ${skipped.join(', ')}`)
  process.exit(0)
}
const assets = JSON.parse(read(assetsPath))
const MEDIA = { png: 'image/png', svg: 'image/svg+xml' }
const group = (dir, order, tile) => {
  const files = {}
  for (const f of order) {
    // The store's own record: it sanitises SVGs, so the stored size is its own.
    const upload = assets.blobs[`${dir}/${f}`]
    if (!upload) fail(`assets.json has no upload for ${dir}/${f}`)
    files[f] = { name: f, blob: upload.blob, size: upload.size, type: MEDIA[f.split('.').pop()] }
  }
  return { name: dir, tile, order, files }
}
const logoOrder = ['visvine-mark.svg', 'visvine-tile.svg', 'brand-icon.png', 'ios-logo.png', 'ios-app-icon.png']
write('design-system.json', json({
  v: 3,
  layout: 'files',
  createdOnFiles: assets.createdOnFiles,
  title: 'Visvine',
  namespace: NAMESPACE,
  libraries: [
    { name: 'react', version: '19.2.8', global: 'React', file: 'components/lib/react.js' },
    { name: 'react-dom', version: '19.2.8', global: 'ReactDOM', file: 'components/lib/react-dom.js' },
  ],
  sections: {},
  groups: ['Logos', 'Icons'],
  assetGroups: { Logos: group('Logos', logoOrder, 'l'), Icons: group('Icons', icons, 'xs') },
  blobs: {},
  docs: { sections: [] },
  lastChange: { by: assets.by, at: new Date().toISOString(), via: `GitHub · Conz-Wilts/Visvine@${ghead}`, note: assets.note },
}))
console.log(`✓ project/ written with the index (${names.length} components, ${colorTokens.length} colours, ${icons.length} icons)`)
if (skipped.length) console.log(`  not placed: ${skipped.join(', ')}`)
