/**
 * The vendor ESM a Tool frame runs on — React, the JSX runtime, the DOM client
 * and `@visvine/tool-kit` — built once per process by esbuild and served from
 * the tools origin.
 *
 * A compiled Tool (lib/tools/compile.ts) leaves those four specifiers as BARE
 * imports; the frame document's import map (lib/tools/frameDocument.ts) points
 * them here. That is what keeps a Tool bundle small, keeps every Tool on ONE
 * React instance — `react-dom-client.js` marks `react` external so it resolves
 * through the same map entry the Tool does — and keeps `script-src 'self'`
 * honest, because nothing is fetched from a CDN.
 *
 * Two things about the entry sources are worth knowing before editing them:
 *
 *   • `export * from 'react'` DOES NOT WORK. React ships CommonJS, and a
 *     star re-export of a CJS module cannot be resolved statically, so esbuild
 *     emits a module whose only export is `default` — every
 *     `import { useState } from 'react'` in every Tool would be undefined.
 *     Verified, not assumed. The entries below therefore name each export,
 *     read off the module itself at build time so a React upgrade needs no
 *     edit here.
 *   • The entries are compiled from files on disk — `features/tools/kit/*`
 *     and React's own package — that nothing in the app imports, so a
 *     standalone build cannot trace all of them. In production the four
 *     modules are therefore read from `public/tool-runtime/`, written by
 *     `scripts/build-tool-vendor.ts` before `next build`; esbuild only runs
 *     here in development. See the note in next.config.ts.
 *
 * Building is memoised on one promise for all four files: they are pure
 * functions of the tree on disk, the first frame load pays for them, and the
 * frame document needs every ETag at once anyway.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, type Plugin } from 'esbuild'
import { logger } from '@/lib/logger'
import { CURATED_DEPENDENCIES, curatedPackageOf, type CuratedDependencyName } from '@visvine/tool-protocol/dependencies'

/**
 * The files the import map names: React, its JSX runtime and DOM client, the
 * kit, and one per curated dependency (@visvine/tool-protocol/dependencies).
 * Nothing else is servable.
 */
export const VENDOR_FILES = [
  'react.js',
  'react-jsx-runtime.js',
  'react-dom.js',
  'react-dom-client.js',
  'tool-kit.js',
  'tool-kit-1.js',
  'tool-kit.css',
  'dep-zod.js',
  'dep-date-fns.js',
  'dep-clsx.js',
  'dep-lucide-react.js',
  'dep-motion-react.js',
  'dep-dnd-kit-core.js',
  'dep-dnd-kit-sortable.js',
  'dep-dnd-kit-utilities.js',
  'dep-tanstack-react-table.js',
  'dep-react-hook-form.js',
  'dep-papaparse.js',
  'dep-fuse.js',
  'dep-nanoid.js',
] as const

export type VendorFileName = (typeof VENDOR_FILES)[number]

export interface VendorFile {
  /** The built ESM module. */
  code: string
  /** sha1 of `code`, as the `?v=` cache buster and the `ETag`. */
  etag: string
}

/** Narrows an arbitrary URL segment to one of the four names. */
export function isVendorFileName(value: string): value is VendorFileName {
  return (VENDOR_FILES as readonly string[]).includes(value)
}

// ── locating the app on disk ──────────────────────────────────────────────────

const PACKAGE_NAME = '@visvine/web'

/** The kit sources, relative to the app root. */
const KIT_DIR = join('features', 'tools', 'kit')

function isAppRoot(dir: string): boolean {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return false
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === PACKAGE_NAME
  } catch {
    return false
  }
}

/**
 * `apps/web` on disk — where esbuild resolves `react` from and where the kit
 * sources live.
 *
 * Found by walking up from the working directory rather than from a module
 * path: `next dev` and the standalone server both run WITH apps/web as their
 * cwd, and a bundled route handler has no reliable path of its own (`__dirname`
 * points inside `.next/server`, and `import.meta.url` is rewritten by the
 * bundler). The `apps/web` probe covers a caller that started at the repo root,
 * which is how the test runner and the verify scripts are sometimes invoked.
 */
let appRootCache: string | null = null

function appRoot(): string {
  if (appRootCache) return appRootCache
  let dir = process.cwd()
  for (;;) {
    if (isAppRoot(dir)) {
      appRootCache = dir
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const nested = join(process.cwd(), 'apps', 'web')
  if (isAppRoot(nested)) {
    appRootCache = nested
    return nested
  }
  throw new Error(
    `Cannot build the Tool vendor bundles: no ${PACKAGE_NAME} package.json at or above ${process.cwd()}`,
  )
}

// ── entry sources ─────────────────────────────────────────────────────────────

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * The named exports of a CommonJS module, read from the module itself.
 *
 * `createRequire` anchored at the app's own package.json, so this resolves the
 * same `react` esbuild is about to bundle rather than whatever copy the Next
 * server bundle happens to hold. `default` is handled separately below, and a
 * key that isn't a plain identifier is dropped because it cannot be written as
 * an ESM export name (React has none).
 */
function namedExportsOf(specifier: string): string[] {
  const require = createRequire(pathToFileURL(join(appRoot(), 'package.json')))
  const loaded = require(specifier) as Record<string, unknown>
  return Object.keys(loaded)
    .filter((key) => key !== 'default' && IDENTIFIER_RE.test(key))
    .sort()
}

/**
 * An ESM module that re-exports a CommonJS one by name. `__mod` is the CJS
 * `module.exports` (esbuild's interop puts it on `default`), so `default` is
 * the whole React object — what `import React from 'react'` expects.
 */
function reExportEntry(specifier: string): string {
  const names = namedExportsOf(specifier)
  return [
    `import * as __ns from ${JSON.stringify(specifier)}`,
    'const __mod = __ns.default ?? __ns',
    'export default __mod',
    names.length > 0 ? `export const { ${names.join(', ')} } = __mod` : '',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** A curated dependency's file → its package, for the build below. */
function dependencyOf(file: VendorFileName): CuratedDependencyName | null {
  const found = (Object.entries(CURATED_DEPENDENCIES) as Array<[CuratedDependencyName, { file: string }]>).find(
    ([, dep]) => dep.file === file,
  )
  return found ? found[0] : null
}

/**
 * The version of a package on disk. Read from its own package.json, found by
 * walking up from its entry — `<name>/package.json` is not a subpath every
 * package exports.
 */
export function installedVersion(name: string): string {
  const require = createRequire(pathToFileURL(join(appRoot(), 'package.json')))
  let dir = dirname(require.resolve(name))
  for (;;) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string }
      if (parsed.name === name && parsed.version) return parsed.version
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`No package.json for ${name}`)
    dir = parent
  }
}

/**
 * An ESM package re-exported whole. Its `default` rides along when it has
 * one — read off the module at build time, like React's names above.
 */
async function dependencyEntry(name: CuratedDependencyName, withDefault = true): Promise<string> {
  const require = createRequire(pathToFileURL(join(appRoot(), 'package.json')))
  const spec = JSON.stringify(name)
  const pkg = JSON.parse(readFileSync(packageJsonOf(curatedPackageOf(name), require), 'utf8')) as {
    type?: string
    module?: string
    exports?: unknown
  }
  if (pkg.type === 'module' || pkg.module || JSON.stringify(pkg.exports ?? '').includes('"import"')) {
    return [`export * from ${spec}`, withDefault ? `export { default } from ${spec}` : '', ''].filter(Boolean).join('\n')
  }
  const loaded = require(name) as Record<string, unknown>
  // CommonJS: esbuild cannot see through `export *` of one, so its names are
  // listed from the module Node loaded — the same object the browser gets.
  const names = Object.keys((loaded.default ?? loaded) as object).filter((key) => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'default')
  return [`import __m from ${spec}`, 'export default __m', names.length ? `export const { ${names.join(', ')} } = __m` : '', ''].filter(Boolean).join('\n')
}

/** A package's own package.json, walking up from its entry. */
function packageJsonOf(name: string, require: NodeJS.Require): string {
  let dir = dirname(require.resolve(name))
  for (;;) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === name) return manifest
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`No package.json for ${name}`)
    dir = parent
  }
}

/** Tailwind's spacing scale, every step — a Tool may reach for any of them. */
const SCALE = '{0,px,0.5,1,1.5,2,2.5,3,3.5,4,5,6,7,8,9,10,11,12,14,16,20,24,28,32,36,40,44,48,52,56,60,64,72,80,96}'

/**
 * The layout utilities a Tool's own markup reaches for, compiled in whether or
 * not the kit happens to use them. The stylesheet is built from the kit's
 * sources, not the Tool's, so without this a Tool's `grid-cols-3` or `text-2xl`
 * would name a class that does not exist and silently draw nothing — rows that
 * never become a grid, spacing that never lands. Layout, type and the role
 * colours — never a palette or a hex.
 */
const TOOL_LAYOUT_UTILITIES: readonly string[] = [
  '{sm:,md:,lg:,xl:,}grid-cols-{1,2,3,4,5,6,7,8,9,10,11,12}',
  '{sm:,md:,lg:,xl:,}col-span-{1,2,3,4,5,6,7,8,9,10,11,12,full}',
  '{sm:,md:,lg:,xl:,}{grid,flex,inline-flex,block,inline-block,hidden,contents}',
  '{sm:,md:,lg:,}flex-{row,col,wrap,1,none,auto}',
  '{sm:,md:,lg:,}{items,self}-{start,center,end,stretch,baseline}',
  '{sm:,md:,lg:,}justify-{start,center,end,between,around}',
  `{sm:,md:,lg:,}{gap,gap-x,gap-y,space-y,space-x}-${SCALE}`,
  `{sm:,md:,lg:,}{p,px,py,pt,pb,pl,pr,m,mx,my,mt,mb,ml,mr,-mt,-mb,-ml,-mr}-${SCALE}`,
  `{sm:,md:,lg:,}{w,h,min-w,min-h,max-h,size,top,bottom,left,right}-${SCALE}`,
  '{sm:,md:,lg:,}{w,h,min-w,min-h,max-w,max-h}-{full,fit,min,max,auto,screen}',
  '{sm:,md:,lg:,}w-{1/2,1/3,2/3,1/4,3/4}',
  'max-w-{xs,sm,md,lg,xl,2xl,3xl,4xl,5xl,6xl,prose}',
  'shrink-0 grow min-w-0 truncate break-words whitespace-nowrap overflow-{hidden,auto,x-auto,y-auto}',
  '{sm:,md:,lg:,}text-{xs,sm,base,lg,xl,2xl,3xl,4xl,5xl} {text-left,text-center,text-right}',
  'font-{normal,medium,semibold,bold} leading-{none,tight,snug,normal,relaxed} tracking-{tight,wide} tabular-nums uppercase',
  'rounded{,-sm,-md,-lg,-xl,-2xl,-full} border{,-2,-t,-b,-l,-r,-0} divide-{y,x}',
  '{hover:,focus-visible:,group-hover:,}{border,divide}-{line,line-subtle,accent,danger,success-line,warning-line,info-line,danger-line}',
  '{hover:,focus-visible:,group-hover:,}{text,bg}-{fg,fg-secondary,fg-muted,fg-subtle,fg-inverse,fg-link,accent,accent-strong,danger,surface,surface-subtle,surface-muted,accent-soft,danger-wash}',
  '{text,bg,border}-{success,warning,info}{,-wash,-strong,-line}',
  '{hover:,}{text,bg,border}-hue-{gray,red,orange,amber,yellow,green,teal,cyan,sky,blue,indigo,violet,pink}{,-fg,-wash,-line}',
  '{relative,absolute,sticky,fixed} inset-0 top-0 {z-0,z-10,z-20} aspect-{square,video} opacity-{0,40,50,60,70,100} {group-hover:,}opacity-100',
  'group cursor-pointer select-none pointer-events-none transition{,-colors,-opacity,-transform} duration-{100,150,200} ease-out',
  'shadow{,-sm,-md,-lg} ring{,-1,-2} ring-{line,accent} outline-none line-clamp-{1,2,3} object-{cover,contain} list-{disc,decimal} list-inside',
  '{sm:,md:,lg:,}{order-first,order-last} items-stretch place-items-center grid-rows-{1,2,3} auto-rows-fr',
]

/**
 * The kit's stylesheet: the design tokens, the @theme that names Tailwind's
 * utilities after them, and every utility `@visvine/ui` and the kit use —
 * compiled the way the app's own globals.css is, so a Tool's components are
 * the app's components, painted the same. Tailwind's preflight comes with it:
 * the frame is a document of its own and starts from the same reset.
 */
async function buildKitStylesheet(): Promise<string> {
  const root = appRoot()
  const { compile, optimize } = await import('@tailwindcss/node')
  const { Scanner } = await import('@tailwindcss/oxide')
  const input = [
    '@import "tailwindcss" source(none);',
    '@import "@visvine/tokens/tokens.css";',
    '@import "@visvine/tokens/theme.css";',
    '@source "../../packages/ui/src";',
    `@source "./${KIT_DIR.split('\\').join('/')}";`,
    // The starting Tools a build copies (lib/tools/templates) draw with their
    // own classes; compiling them in means a template never loses a style.
    '@source "./lib/tools/templates/sources";',
    ...TOOL_LAYOUT_UTILITIES.map((set) => `@source inline("${set}");`),
  ].join('\n')
  const compiler = await compile(input, { base: root, onDependency: () => {} })
  const scanner = new Scanner({ sources: compiler.sources })
  return optimize(compiler.build(scanner.scan()), { minify: true }).code
}

/** The `@visvine/tool-kit` surface, kit 2: the author-facing exports plus the booter. */
const KIT_ENTRY = "export * from './index'\nexport { bootTool } from './runtime'\n"

/** Kit 1's surface, frozen, for a Tool written against it. */
const KIT1_ENTRY = "export * from './kit1'\nexport { bootLegacyTool as bootTool } from './legacyBoot'\n"

/**
 * Marks a specifier external in a way a CommonJS dependency can actually use.
 *
 * Plain `external: ['react']` is not enough here. React DOM is CommonJS and
 * reaches React with `require('react')`, and esbuild cannot turn a synchronous
 * `require` of an external into an ESM import — so it silently (no warning,
 * checked) emits a `Dynamic require of "react" is not supported` shim that
 * throws the moment the renderer loads in a browser.
 *
 * Resolving `react` to a one-line ESM stub that re-exports the real external
 * gives the CJS code an in-bundle module to require, and leaves the output
 * with a genuine `import * as … from "react"` for the import map to resolve —
 * which is what keeps every Tool, the kit and the renderer on one React.
 */
function externalViaEsm(specifiers: string[], resolveDir: string): Plugin {
  const NAMESPACE = 'vv-external-esm'
  const filter = new RegExp(`^(?:${specifiers.map((s) => s.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})$`)
  return {
    name: NAMESPACE,
    setup(hooks) {
      hooks.onResolve({ filter }, (args) =>
        args.namespace === NAMESPACE
          ? { path: args.path, external: true }
          : { path: args.path, namespace: NAMESPACE },
      )
      hooks.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
        contents: `export * from ${JSON.stringify(args.path)}\nexport { default } from ${JSON.stringify(args.path)}\n`,
        loader: 'js',
        resolveDir,
      }))
    },
  }
}

/** esbuild's give-up shim for a `require` it could not turn into an import. */
const DYNAMIC_REQUIRE_MARKER = 'Dynamic require of '

// ── building ──────────────────────────────────────────────────────────────────

/**
 * `NODE_ENV` is pinned to production for every vendor build: these files are
 * shipped to a browser, and React's development build is both far larger and
 * full of warnings addressed to whoever wrote the app rather than the Tool.
 */
const DEFINE = { 'process.env.NODE_ENV': '"production"' } as const

async function buildModule(opts: {
  contents: string
  resolveDir: string
  sourcefile: string
  loader: 'js' | 'ts'
  external?: string[]
  plugins?: Plugin[]
}): Promise<string> {
  const result = await build({
    stdin: {
      contents: opts.contents,
      resolveDir: opts.resolveDir,
      sourcefile: opts.sourcefile,
      loader: opts.loader,
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'react',
    external: opts.external,
    plugins: opts.plugins,
    define: DEFINE,
    minify: true,
    write: false,
    // Keeps React's `@license` banners in the output — these are third-party
    // MIT sources being redistributed.
    legalComments: 'eof',
    logLevel: 'silent',
  })
  for (const warning of result.warnings) {
    logger.warn('tools.vendor_build.warning', { sourcefile: opts.sourcefile, text: warning.text })
  }
  const code = result.outputFiles[0]?.text
  if (!code) throw new Error(`esbuild produced no output for ${opts.sourcefile}`)
  // esbuild does not warn about this, so it has to be checked. A module that
  // reaches this state loads fine and then throws on first use in the browser,
  // which is the worst possible time to find out.
  if (code.includes(DYNAMIC_REQUIRE_MARKER)) {
    throw new Error(
      `${opts.sourcefile} still contains a dynamic require — an external is not reachable as ESM`,
    )
  }
  return code
}

async function buildOne(name: VendorFileName): Promise<string> {
  const root = appRoot()
  const dependency = dependencyOf(name)
  if (dependency) {
    // Pinned: the version on disk is the one the table promises every Tool.
    const served = installedVersion(curatedPackageOf(dependency))
    if (served !== CURATED_DEPENDENCIES[dependency].version) {
      throw new Error(`${dependency} is ${served} on disk but the curated table serves ${CURATED_DEPENDENCIES[dependency].version}`)
    }
    // React and every other curated module stay external, so a package that
    // builds on another (@dnd-kit/sortable on core) shares the one copy the
    // import map serves instead of bundling a second context of its own.
    // React goes through the ESM stub (a CommonJS dependency requires it);
    // the curated modules are ESM themselves and stay plain externals.
    const bundle = async (withDefault: boolean) =>
      buildModule({
        contents: await dependencyEntry(dependency, withDefault),
        resolveDir: root,
        sourcefile: name,
        loader: 'js',
        external: Object.keys(CURATED_DEPENDENCIES).filter((other) => other !== dependency),
        plugins: [externalViaEsm(['react', 'react-dom', 'react/jsx-runtime'], root)],
      })
    // An ES module's default export is re-exported when it has one; which
    // ones do is esbuild's to say, not a guess made here.
    return bundle(true).catch((err: unknown) => {
      if (err instanceof Error && /No matching export .* for import "default"/.test(err.message)) return bundle(false)
      throw err
    })
  }
  switch (name) {
    case 'react.js':
      return buildModule({
        contents: reExportEntry('react'),
        resolveDir: root,
        sourcefile: name,
        loader: 'js',
      })
    case 'react-jsx-runtime.js':
      // Not marked external against `react`: esbuild's externals match
      // subpaths too, so `external: ['react']` here would externalise
      // `react/jsx-runtime` itself and emit a module that re-exports itself.
      // It costs nothing anyway — React 19's JSX runtime imports no React.
      return buildModule({
        contents: reExportEntry('react/jsx-runtime'),
        resolveDir: root,
        sourcefile: name,
        loader: 'js',
      })
    case 'react-dom.js':
      // `createPortal` and `flushSync` — what the kit's dialogs and toasts
      // (@visvine/ui) reach for. The one React DOM instance the renderer
      // below shares.
      return buildModule({
        contents: reExportEntry('react-dom'),
        resolveDir: root,
        sourcefile: name,
        loader: 'js',
        plugins: [externalViaEsm(['react'], root)],
      })
    case 'react-dom-client.js':
      // Keeping `react` and `react-dom` external is the whole point: the
      // renderer must share the React instance the Tool and the kit got from
      // the import map, or hooks throw, and the React DOM instance a portal
      // was made with. The plugin rather than `external` is what makes React
      // DOM's CommonJS `require('react')` survive the trip.
      return buildModule({
        contents: reExportEntry('react-dom/client'),
        resolveDir: root,
        sourcefile: name,
        loader: 'js',
        plugins: [externalViaEsm(['react', 'react-dom'], root)],
      })
    case 'tool-kit.css':
      return buildKitStylesheet()
    case 'tool-kit.js':
      // The kit bundles recharts and react-markdown, whose CommonJS
      // dependencies `require('react')` — so the same ESM-stub plugin the
      // renderer uses, for the same reason: every Tool, the kit and the
      // charts must share the one React the import map serves.
      return buildModule({
        contents: KIT_ENTRY,
        resolveDir: join(root, KIT_DIR),
        sourcefile: 'tool-kit.ts',
        loader: 'ts',
        plugins: [externalViaEsm(['react', 'react-dom', 'react-dom/client'], root)],
      })
    case 'tool-kit-1.js':
      return buildModule({
        contents: KIT1_ENTRY,
        resolveDir: join(root, KIT_DIR),
        sourcefile: 'tool-kit-1.ts',
        loader: 'ts',
        plugins: [externalViaEsm(['react', 'react-dom', 'react-dom/client'], root)],
      })
    default:
      throw new Error(`No vendor build for ${name}`)
  }
}

function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

/** Where `scripts/build-tool-vendor.ts` leaves its output, relative to the app root. */
const PREBUILT_VENDOR_DIR = join('public', 'tool-runtime')

/**
 * The prebuilt directory, absolute. Exported so the prebuild script writes
 * exactly where this module reads, whatever directory it was invoked from.
 */
export function vendorOutputDir(): string {
  return join(appRoot(), PREBUILT_VENDOR_DIR)
}

/**
 * The prebuilt modules, or null if any of the four is missing.
 *
 * Only consulted in production. In development the sources on disk are the
 * truth — a leftover artifact from someone's `next build` must not shadow an
 * edit to the kit — and esbuild is fast enough that nobody notices.
 */
function readPrebuilt(): Record<VendorFileName, VendorFile> | null {
  if (process.env.NODE_ENV !== 'production') return null
  const dir = vendorOutputDir()
  try {
    const entries = VENDOR_FILES.map((name) => {
      const code = readFileSync(join(dir, name), 'utf8')
      return [name, { code, etag: sha1(code) }] as const
    })
    return Object.fromEntries(entries) as Record<VendorFileName, VendorFile>
  } catch {
    return null
  }
}

let cache: Promise<Record<VendorFileName, VendorFile>> | null = null

/** Builds all four with esbuild. Exported for the prebuild script. */
export function buildVendorFiles(): Promise<Record<VendorFileName, VendorFile>> {
  return Promise.all(
    VENDOR_FILES.map(async (name) => {
      const code = await buildOne(name)
      return [name, { code, etag: sha1(code) }] as const
    }),
  ).then((entries) => Object.fromEntries(entries) as Record<VendorFileName, VendorFile>)
}

async function loadAll(): Promise<Record<VendorFileName, VendorFile>> {
  return readPrebuilt() ?? (await buildVendorFiles())
}

/**
 * One vendor module. The build is memoised for the life of the process; a
 * failure clears the memo so the next request retries rather than serving the
 * same error until a redeploy.
 */
export async function vendorFile(name: VendorFileName): Promise<VendorFile> {
  if (!cache) {
    cache = loadAll().catch((e: unknown) => {
      cache = null
      throw e
    })
  }
  return (await cache)[name]
}

/**
 * Every vendor ETag, for the frame document's import map — a `?v=<etag>` on
 * each URL is what makes it safe to cache them for a year.
 */
export async function vendorVersions(): Promise<Record<VendorFileName, string>> {
  const built = await Promise.all(VENDOR_FILES.map((name) => vendorFile(name)))
  return Object.fromEntries(
    VENDOR_FILES.map((name, i) => [name, built[i].etag]),
  ) as Record<VendorFileName, string>
}
