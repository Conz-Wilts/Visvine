/**
 * Build the Tool frame's vendor ESM ahead of `next build`.
 *
 * The four modules (React, the JSX runtime, the DOM client, `@visvine/tool-kit`)
 * are compiled from files nothing in the app imports — `features/tools/kit/*`
 * and React's own package — which means Next's output tracing cannot carry all
 * of them into a standalone image, so building them on first request there is
 * not an option. They are written into `public/` instead, which standalone
 * copies whole; `lib/tools/vendorBundle.ts` reads them from there in production
 * and falls back to esbuild in development.
 *
 * Run: pnpm --filter @visvine/web exec tsx scripts/build-tool-vendor.ts
 * (wired into this package's `build` script — the deploy image runs it too).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildVendorFiles, vendorOutputDir } from '../lib/tools/vendorBundle'

async function main(): Promise<void> {
  const outDir = vendorOutputDir()
  // Rebuilt from scratch: a file left over from an older kit would otherwise
  // be served forever, since presence is what makes the route prefer these.
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const built = await buildVendorFiles()
  for (const [name, file] of Object.entries(built)) {
    writeFileSync(join(outDir, name), file.code, 'utf8')
    console.log(`${name}  ${file.code.length} bytes  ${file.etag}`)
  }
}

main().catch((e: unknown) => {
  console.error('Failed to build the Tool vendor modules:', e)
  process.exit(1)
})
