/**
 * A folder of work as a Tool: the files that make its `.vvtool` package, read
 * the way the server reads a package — `readPackageFiles`, the same function —
 * so a project that passes here is one Visvine will take.
 *
 *   visvine-tool.json    the manifest
 *   src/ui.tsx           the entry; src/<name>.tsx|ts further modules
 *   src/data.js          optional handlers
 *   README.md            the docs; CHANGELOG.md the release notes
 *   LICENSE, icon.svg    optional
 *
 * Everything else — fixtures/, node_modules/, the repo's own files — stays
 * behind; tests and declaration files beside the sources are skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  checksumsText,
  encodePackage,
  fileDigests,
  packageDigestOf,
  PACKAGE_CHECKSUMS,
  PACKAGE_MANIFEST,
  readPackageFiles,
  type PackageRead,
} from '@/lib/tools/package/shared/layout'

const TOP_FILES = [PACKAGE_MANIFEST, 'README.md', 'CHANGELOG.md', 'LICENSE', 'icon.svg']
/** Files beside the sources that belong to the author's own tooling, not the Tool. */
const DEV_ONLY = /(\.d\.ts|\.(test|spec)\.[cm]?[jt]sx?)$/

export class ProjectError extends Error {}

/** The files of the project a package is made from, path → text. */
export function projectFiles(dir: string): Record<string, string> {
  if (!existsSync(join(dir, PACKAGE_MANIFEST))) {
    throw new ProjectError(`No ${PACKAGE_MANIFEST} in ${dir} — run this in a Tool's folder, or start one with \`visvine-tool init\`.`)
  }
  const files: Record<string, string> = {}
  for (const name of TOP_FILES) {
    const path = join(dir, name)
    if (existsSync(path)) files[name] = readFileSync(path, 'utf8')
  }
  const src = join(dir, 'src')
  if (existsSync(src)) {
    for (const name of readdirSync(src).sort()) {
      const path = join(src, name)
      if (name.startsWith('.') || DEV_ONLY.test(name) || !statSync(path).isFile()) continue
      files[`src/${name}`] = readFileSync(path, 'utf8')
    }
  }
  return files
}

/** The project read as Visvine reads a package, or the one sentence saying why not. */
export function readProject(dir: string, opts: { name?: string } = {}): PackageRead {
  const read = readPackageFiles(projectFiles(dir), opts)
  if (!read.ok) throw new ProjectError(read.error)
  return read.pkg
}

/** The project as a `.vvtool`: its files, CHECKSUMS, zipped. Never signed — only Visvine signs. */
export function packProject(dir: string, opts: { name?: string } = {}): { name: string; bytes: Uint8Array; digest: string; files: string[] } {
  const pkg = readProject(dir, opts)
  const files = projectFiles(dir)
  const digests = fileDigests(files)
  return {
    name: pkg.name,
    bytes: encodePackage({ ...files, [PACKAGE_CHECKSUMS]: checksumsText(digests) }),
    digest: packageDigestOf(digests),
    files: Object.keys(files).sort(),
  }
}

/** CHANGELOG.md's newest section — what a publish carries as its release notes. */
export function releaseNotes(dir: string): string | null {
  const path = join(dir, 'CHANGELOG.md')
  if (!existsSync(path)) return null
  const lines = readFileSync(path, 'utf8').split('\n')
  const first = lines.findIndex((line) => /^##\s/.test(line))
  if (first === -1) return null
  const next = lines.findIndex((line, at) => at > first && /^##\s/.test(line))
  const notes = lines.slice(first + 1, next === -1 ? undefined : next).join('\n').trim()
  return notes ? notes.slice(0, 2048) : null
}
