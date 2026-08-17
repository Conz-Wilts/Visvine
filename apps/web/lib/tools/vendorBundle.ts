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

/** The four files the import map names. Nothing else is servable. */
export const VENDOR_FILES = [
  'react.js',
  'react-jsx-runtime.js',
  'react-dom-client.js',
  'tool-kit.js',
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

/** The `@visvine/tool-kit` surface: the author-facing exports plus the booter. */
const KIT_ENTRY = "export * from './index'\nexport { bootTool } from './runtime'\n"

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
    console.warn(`[tools] vendor build warning in ${opts.sourcefile}: ${warning.text}`)
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

function buildOne(name: VendorFileName): Promise<string> {
  const root = appRoot()
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
    case 'react-dom-client.js':
      // Keeping `react` external is the whole point: the renderer must share
      // the React instance the Tool and the kit got from the import map, or
      // hooks throw. `react-dom` itself is not external — this file is its
      // only consumer — and the plugin rather than `external` is what makes
      // React DOM's CommonJS `require('react')` survive the trip.
      return buildModule({
        contents: reExportEntry('react-dom/client'),
        resolveDir: root,
        sourcefile: name,
        loader: 'js',
        plugins: [externalViaEsm(['react'], root)],
      })
    case 'tool-kit.js':
      return buildModule({
        contents: KIT_ENTRY,
        resolveDir: join(root, KIT_DIR),
        sourcefile: 'tool-kit.ts',
        loader: 'ts',
        external: ['react', 'react-dom/client'],
      })
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
