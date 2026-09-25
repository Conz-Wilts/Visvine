/**
 * Build what a Tool author installs, from this repo's own code:
 *
 *   packages/tool-kit      index.d.ts (the kit's types), runtime/ (the frame's
 *                          React, kit and stylesheet — lib/tools/vendorBundle),
 *                          dist/mock.js (the offline runtime)
 *   packages/tool-cli      dist/cli.js — the compiler, the checks and the
 *                          package format bundled from lib/tools, so the CLI
 *                          answers what the server answers — dist/host.{js,html}
 *                          (the dev page) and dist/template (the starter)
 *   packages/tool-starter  AGENTS.md and COMPONENTS.md
 *
 * The generated docs and types are committed; `--check` fails when one has
 * drifted from what lib/tools/starterDocs.ts renders (tests/tools-starter.test.ts
 * asks the same). The builds are not committed — run this before packing.
 *
 *   pnpm --filter @visvine/web tools:packages [--check]
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { buildVendorFiles } from '../lib/tools/vendorBundle'
import { renderKitDts, renderStarterAgents, renderStarterComponents } from '../lib/tools/starterDocs'

const APP = process.cwd().endsWith(join('apps', 'web')) ? process.cwd() : resolve(process.cwd(), 'apps', 'web')
const ROOT = resolve(APP, '..', '..')
const KIT = join(ROOT, 'packages', 'tool-kit')
const CLI = join(ROOT, 'packages', 'tool-cli')
const STARTER = join(ROOT, 'packages', 'tool-starter')

const GENERATED: Record<string, string> = {
  [join(KIT, 'index.d.ts')]: renderKitDts(),
  [join(STARTER, 'AGENTS.md')]: renderStarterAgents(),
  [join(STARTER, 'COMPONENTS.md')]: renderStarterComponents(),
}

/** CommonJS inside the ESM bundle still calls `require` — give it one. */
const NODE_BANNER = "import { createRequire as __vvCreateRequire } from 'node:module'; const require = __vvCreateRequire(import.meta.url);"

async function main(): Promise<void> {
  const stale = Object.entries(GENERATED).filter(([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text)
  if (process.argv.includes('--check')) {
    for (const [path] of stale) console.error(`${path.slice(ROOT.length + 1)} is out of date — run tools:packages`)
    process.exit(stale.length ? 1 : 0)
  }
  for (const [path, text] of Object.entries(GENERATED)) writeFileSync(path, text)
  console.log(`docs    ${Object.keys(GENERATED).length} files`)

  // The frame's own runtime, exactly the files the tools origin serves.
  const runtime = join(KIT, 'runtime')
  rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  for (const [name, file] of Object.entries(await buildVendorFiles())) writeFileSync(join(runtime, name), file.code)
  console.log('runtime tool-kit/runtime')

  await build({
    entryPoints: [join(KIT, 'src', 'index.ts')],
    outfile: join(KIT, 'dist', 'mock.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: { js: NODE_BANNER },
    logLevel: 'warning',
  })
  console.log('mock    tool-kit/dist/mock.js')

  rmSync(join(CLI, 'dist'), { recursive: true, force: true })
  await build({
    entryPoints: [join(CLI, 'src', 'cli.ts')],
    outfile: join(CLI, 'dist', 'cli.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    alias: { '@': APP },
    external: ['esbuild', '@visvine/tool-kit', '@visvine/tool-kit/mock'],
    banner: { js: `#!/usr/bin/env node\n${NODE_BANNER}` },
    logLevel: 'warning',
  })
  chmodSync(join(CLI, 'dist', 'cli.js'), 0o755)
  await build({
    entryPoints: [join(CLI, 'src', 'dev', 'host.ts')],
    outfile: join(CLI, 'dist', 'host.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    alias: { '@': APP },
    logLevel: 'warning',
  })
  cpSync(join(CLI, 'src', 'dev', 'host.html'), join(CLI, 'dist', 'host.html'))
  cpSync(STARTER, join(CLI, 'dist', 'template'), {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|\.visvine|dist)([\\/]|$)|\.vvtool$|\.tgz$/.test(src.slice(STARTER.length)),
  })
  console.log('cli     tool-cli/dist')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
