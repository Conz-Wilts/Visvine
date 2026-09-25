/**
 * A Tool as a file: the `.vvtool` package. Pure — the layout, the manifest a
 * package carries, CHECKSUMS, the zip itself, and reading one back.
 *
 *   deal-pipeline.vvtool          a zip
 *   ├── visvine-tool.json         the manifest: prose, surfaces and every fact
 *   ├── README.md                 the index note's body — the Tool's docs
 *   ├── CHANGELOG.md              release notes, newest first
 *   ├── LICENSE                   when the version carries one
 *   ├── icon.svg                  its own rail glyph, sanitized
 *   ├── src/ui.tsx                the entry; further modules beside it
 *   ├── src/data.js               the isolate's handlers, when it has any
 *   └── .visvine/                 written by Visvine on export, never by authors
 *       ├── CHECKSUMS             sha256 per file
 *       └── SIGNATURE             Ed25519 — a LISTED version's export only
 *
 * Sources only. The server compiles, so what runs is what was reviewed: a
 * package whose code is minified is refused, and nothing in it is ever run as
 * shipped. Whatever else a folder of work holds — `fixtures/`, `node_modules/`,
 * the starter repo's own files, dotfiles — is ignored on import, not refused.
 */
import { createHash } from 'node:crypto'
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { joinFrontmatter } from '@/lib/notes/shared/markdown'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { MANIFEST_FACT_KEYS, parseManifestFacts, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import { MAX_TOOL_MODULES, parseToolConfig, TOOL_MODULE_RE, TOOL_NAME_RE, type ToolConfig } from '../../config'
import { scanSourceText } from '../../checks/textRules'

export const PACKAGE_EXTENSION = '.vvtool'
export const PACKAGE_MANIFEST = 'visvine-tool.json'
export const PACKAGE_CHECKSUMS = '.visvine/CHECKSUMS'
export const PACKAGE_SIGNATURE = '.visvine/SIGNATURE'
const PACKAGE_SCHEMA = 'https://visvine.com/schemas/tool-manifest-2.json'

const ENTRY_UI = 'src/ui.tsx'
const ENTRY_DATA = 'src/data.js'

export const PACKAGE_LIMITS = {
  /** The zip, and everything in it unpacked. */
  maxPackageBytes: 2_000_000,
  /** Every source together — ui, data and modules. */
  maxSourceBytes: 512_000,
  maxFiles: 64,
} as const

/** What a package is made of — from a working copy or a published version. */
export interface PackageSource {
  name: string
  title: string
  description: string
  tags: string[]
  surfaces: ToolConfig['surfaces']
  facts: ToolManifestFacts
  /** The index note's body. */
  docs: string
  ui: string
  data: string | null
  /** `src/chart.tsx` → code. */
  modules: Record<string, string>
  iconSvg: string | null
  /** Release notes, newest first, as `## <release>` sections. */
  changelog: string | null
  /** The registry's number, on the export of a version — read-only on import. */
  version?: number
  /** Named on a signed export only: the listing's publisher. */
  publisher?: { spaceId: string; name: string }
}

// ── making one ───────────────────────────────────────────────────────────────

/** The manifest a package carries, keys in the order a person reads them. */
export function packageManifest(src: PackageSource): Record<string, unknown> {
  const facts = src.facts
  const surfaces: Record<string, unknown> = { rail: src.surfaces.rail, types: src.surfaces.types }
  if (src.surfaces.nav) surfaces.nav = src.surfaces.nav
  if (src.surfaces.actions?.length) surfaces.actions = src.surfaces.actions
  return {
    $schema: PACKAGE_SCHEMA,
    manifestVersion: 2,
    name: src.name,
    title: src.title,
    ...(src.description ? { description: src.description } : {}),
    ...(facts.release ? { release: facts.release } : {}),
    ...(facts.license ? { license: facts.license } : {}),
    ...(src.version !== undefined ? { version: src.version } : {}),
    ...(src.publisher ? { publisher: src.publisher } : {}),
    sdk: facts.sdk,
    platforms: facts.platforms,
    entry: { ui: ENTRY_UI, ...(src.data?.trim() ? { data: ENTRY_DATA } : {}) },
    ...(src.iconSvg ? { icon: 'icon.svg' } : {}),
    ...(Object.keys(facts.dependencies).length ? { dependencies: facts.dependencies } : {}),
    surfaces,
    ...(Object.keys(facts.settings).length ? { settings: facts.settings } : {}),
    ...(Object.keys(facts.bindings).length ? { bindings: facts.bindings } : {}),
    permissions: facts.permissions,
    ...(Object.keys(facts.collections).length ? { collections: facts.collections } : {}),
    ...(src.tags.length ? { tags: src.tags } : {}),
  }
}

/** Every file of a package but `.visvine/`, path → text. */
export function packageFiles(src: PackageSource): Record<string, string> {
  const files: Record<string, string> = {
    [PACKAGE_MANIFEST]: `${JSON.stringify(packageManifest(src), null, 2)}\n`,
    'README.md': src.docs.trim() ? `${src.docs.trim()}\n` : `# ${src.title}\n`,
    [ENTRY_UI]: src.ui,
  }
  if (src.changelog?.trim()) files['CHANGELOG.md'] = `${src.changelog.trim()}\n`
  if (src.facts.license) files.LICENSE = `SPDX-License-Identifier: ${src.facts.license}\n`
  if (src.iconSvg) files['icon.svg'] = src.iconSvg
  if (src.data?.trim()) files[ENTRY_DATA] = src.data
  for (const [file, code] of Object.entries(src.modules)) files[file] = code
  return files
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex')
}

/** Each file's SHA-256, by path. */
export function fileDigests(files: Record<string, string | Uint8Array>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([path, content]) => [path, sha256Hex(content)]))
}

/** `sha256sum`'s format, sorted by path: one `<hex>  <path>` line per file. */
export function checksumsText(digests: Record<string, string>): string {
  return Object.keys(digests)
    .sort()
    .map((path) => `${digests[path]}  ${path}\n`)
    .join('')
}

/** The package's own digest: the SHA-256 of its CHECKSUMS. */
export function packageDigestOf(digests: Record<string, string>): string {
  return sha256Hex(checksumsText(digests))
}

/** What a signature covers: a fixed prefix, then CHECKSUMS, then the manifest. */
export function signedMessage(checksums: string, manifest: string): string {
  return `visvine-tool-signature-v1\n${checksums}${manifest}`
}

/** CHECKSUMS back to path → digest, or null when a line is not one. */
export function parseChecksums(text: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const match = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line)
    if (!match) return null
    out[match[2]] = match[1]
  }
  return out
}

/**
 * The zip. Every entry carries the same fixed time, so the same files always
 * make the same bytes — an export is reproducible, and a test can pin it.
 */
export function encodePackage(files: Record<string, string>): Uint8Array {
  const entries: Zippable = {}
  for (const path of Object.keys(files).sort()) {
    entries[path] = [strToU8(files[path]), { mtime: new Date('1980-01-01T00:00:00Z') }]
  }
  return zipSync(entries, { level: 9 })
}

// ── reading one ──────────────────────────────────────────────────────────────

export type DecodeResult = { ok: true; files: Record<string, string> } | { ok: false; error: string }

/**
 * The zip → its files as text, refused before anything is inflated when it
 * holds too many files or unpacks past the package limit. A path that climbs
 * out (`../`) or is absolute is refused, not normalized.
 */
export function decodePackage(bytes: Uint8Array): DecodeResult {
  if (bytes.byteLength > PACKAGE_LIMITS.maxPackageBytes) {
    return { ok: false, error: `The package is over ${PACKAGE_LIMITS.maxPackageBytes / 1_000_000} MB.` }
  }
  let count = 0
  let unpacked = 0
  let refusal: string | null = null
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false
        count++
        unpacked += file.originalSize
        if (count > PACKAGE_LIMITS.maxFiles * 4) refusal ??= 'The package holds too many files.'
        if (unpacked > PACKAGE_LIMITS.maxPackageBytes) refusal ??= `The package unpacks past ${PACKAGE_LIMITS.maxPackageBytes / 1_000_000} MB.`
        return refusal === null
      },
    })
  } catch {
    return { ok: false, error: 'That is not a .vvtool package — it does not open as a zip.' }
  }
  if (refusal) return { ok: false, error: refusal }
  const files: Record<string, string> = {}
  for (const [path, content] of Object.entries(raw)) {
    if (path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '')) {
      return { ok: false, error: `The package holds a file outside itself: ${path}` }
    }
    files[path] = strFromU8(content)
  }
  return { ok: true, files }
}

/** A package read back: what becomes a working copy, and what came with it. */
interface ReadPackage {
  name: string
  /** The index note to write — prose frontmatter and the docs. */
  indexNote: string
  /** The facts row to write: surfaces and the manifest's facts. */
  facts: Record<string, unknown>
  config: ToolConfig
  ui: string
  data: string | null
  modules: Record<string, string>
  iconSvg: string | null
  /** The top section of CHANGELOG.md — the release notes of the release it carries. */
  releaseNotes: string | null
  /** Set on an exported version: its number, and its publisher when signed. */
  version: number | null
  publisher: { spaceId: string; name: string } | null
  /** The files CHECKSUMS and a signature cover, as found. */
  checksums: string | null
  signature: { keyId: string; signature: string; signedAt: string | null } | null
  manifestText: string
  /** Files the package held that are not part of a Tool. */
  ignored: string[]
}

export type ReadResult = { ok: true; pkg: ReadPackage } | { ok: false; error: string }

/** Folders and files a package is allowed to hold that import never reads. */
function isIgnored(path: string): boolean {
  const first = path.split('/')[0]
  if (first === 'fixtures' || first === 'node_modules' || first === '__MACOSX') return true
  if (first.startsWith('.') && first !== '.visvine') return true
  return path.split('/').some((part) => part.startsWith('._') || part === '.DS_Store')
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** CHANGELOG.md's first `##` section, or the whole file when it has none. */
function topSection(changelog: string | undefined): string | null {
  if (!changelog?.trim()) return null
  const lines = changelog.split('\n')
  const first = lines.findIndex((line) => /^##\s/.test(line))
  if (first === -1) return changelog.trim().slice(0, 2048) || null
  const next = lines.findIndex((line, at) => at > first && /^##\s/.test(line))
  return lines.slice(first + 1, next === -1 ? undefined : next).join('\n').trim().slice(0, 2048) || null
}

/**
 * The files of a decoded package → a working copy's worth of notes and facts,
 * or the one sentence saying why not. Integrity (CHECKSUMS) is checked here
 * because it is pure; the signature is the caller's, against the key ring.
 */
export function readPackageFiles(files: Record<string, string>, opts: { name?: string } = {}): ReadResult {
  // Integrity first, over every file as it came: when the package says what
  // its files hashed to, each must still hash to that, and each must be named.
  const checksums = files[PACKAGE_CHECKSUMS] ?? null
  if (checksums !== null) {
    const listed = parseChecksums(checksums)
    if (!listed) return { ok: false, error: `${PACKAGE_CHECKSUMS} is not a checksum list.` }
    for (const path of Object.keys(files)) {
      if (path.startsWith('.visvine/')) continue
      if (!listed[path]) return { ok: false, error: `${path} was added after the package was made.` }
      if (listed[path] !== sha256Hex(files[path])) return { ok: false, error: `${path} was changed after the package was made.` }
    }
    const missing = Object.keys(listed).find((path) => !(path in files))
    if (missing) return { ok: false, error: `${missing} was removed after the package was made.` }
  }

  const ignored: string[] = []
  const kept: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    if (isIgnored(path)) ignored.push(path)
    else kept[path] = content
  }

  const manifestText = kept[PACKAGE_MANIFEST]
  if (manifestText === undefined) return { ok: false, error: `The package has no ${PACKAGE_MANIFEST}.` }
  let manifest: Record<string, unknown> | null
  try {
    manifest = recordOf(JSON.parse(manifestText))
  } catch {
    manifest = null
  }
  if (!manifest) return { ok: false, error: `${PACKAGE_MANIFEST} is not a JSON object.` }
  if (manifest.manifestVersion !== 2) return { ok: false, error: `${PACKAGE_MANIFEST} must say "manifestVersion": 2.` }

  const name = opts.name?.trim() || (typeof manifest.name === 'string' ? manifest.name : '')
  if (!TOOL_NAME_RE.test(name)) return { ok: false, error: `"${name}" is not a tool name — lower-case letters, digits and hyphens.` }

  const entry = recordOf(manifest.entry) ?? {}
  if (entry.ui !== ENTRY_UI) return { ok: false, error: `entry.ui must be ${ENTRY_UI}.` }
  if (entry.data !== undefined && entry.data !== ENTRY_DATA) return { ok: false, error: `entry.data must be ${ENTRY_DATA}.` }
  const ui = kept[ENTRY_UI]
  if (ui === undefined) return { ok: false, error: `The package has no ${ENTRY_UI}.` }
  const data = entry.data === ENTRY_DATA ? (kept[ENTRY_DATA] ?? null) : null
  if (entry.data === ENTRY_DATA && data === null) return { ok: false, error: `The manifest names ${ENTRY_DATA} but the package has none.` }
  if (data === null && kept[ENTRY_DATA] !== undefined) ignored.push(ENTRY_DATA)

  // Everything else it holds: known files by name, modules under src/, the
  // rest ignored — except under src/, where anything unknown is refused
  // rather than silently dropped, since it may be code the entry imports.
  const modules: Record<string, string> = {}
  const KNOWN = new Set([PACKAGE_MANIFEST, 'README.md', 'CHANGELOG.md', 'LICENSE', 'icon.svg', ENTRY_UI, ENTRY_DATA, PACKAGE_CHECKSUMS, PACKAGE_SIGNATURE])
  for (const path of Object.keys(kept)) {
    if (KNOWN.has(path)) continue
    if (path.startsWith('src/')) {
      if (!TOOL_MODULE_RE.test(path)) {
        return { ok: false, error: `${path} is not a Tool source — modules are src/<name>.tsx or .ts, and the package carries sources, never a build.` }
      }
      modules[path] = kept[path]
      continue
    }
    if (path.startsWith('.visvine/')) return { ok: false, error: `${path} is not a file Visvine writes.` }
    ignored.push(path)
  }
  if (Object.keys(modules).length > MAX_TOOL_MODULES) {
    return { ok: false, error: `The package has more than ${MAX_TOOL_MODULES} modules.` }
  }
  if (Object.keys(files).length > PACKAGE_LIMITS.maxFiles * 4) return { ok: false, error: 'The package holds too many files.' }

  const sources: Array<[string, string]> = [[ENTRY_UI, ui], ...(data !== null ? [[ENTRY_DATA, data] as [string, string]] : []), ...Object.entries(modules)]
  const sourceBytes = sources.reduce((sum, [, code]) => sum + Buffer.byteLength(code, 'utf8'), 0)
  if (sourceBytes > PACKAGE_LIMITS.maxSourceBytes) {
    return { ok: false, error: `The sources are ${sourceBytes} bytes, over the ${PACKAGE_LIMITS.maxSourceBytes} byte limit.` }
  }
  for (const [file, code] of sources) {
    const minified = scanSourceText(code, file as `src/${string}`).find((finding) => finding.rule === 'obfuscation.minified')
    if (minified) return { ok: false, error: `${file}:${minified.line ?? 1} is minified — a package carries sources, never a build.` }
  }

  let signature: ReadPackage['signature'] = null
  const signatureText = kept[PACKAGE_SIGNATURE]
  if (signatureText !== undefined) {
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = recordOf(JSON.parse(signatureText))
    } catch {
      parsed = null
    }
    if (!parsed || parsed.alg !== 'ed25519' || typeof parsed.keyId !== 'string' || typeof parsed.signature !== 'string') {
      return { ok: false, error: `${PACKAGE_SIGNATURE} is not a signature Visvine wrote.` }
    }
    if (checksums === null) return { ok: false, error: `A signed package must carry ${PACKAGE_CHECKSUMS}.` }
    signature = { keyId: parsed.keyId, signature: parsed.signature, signedAt: typeof parsed.signedAt === 'string' ? parsed.signedAt : null }
  }

  // Only Visvine names a publisher, and only under its signature.
  const publisherRaw = recordOf(manifest.publisher)
  if (manifest.publisher !== undefined && !signature) {
    return { ok: false, error: 'Only a package Visvine signed names a publisher — remove "publisher" from the manifest.' }
  }
  const publisher =
    publisherRaw && typeof publisherRaw.spaceId === 'string' && typeof publisherRaw.name === 'string'
      ? { spaceId: publisherRaw.spaceId, name: publisherRaw.name }
      : null

  // The facts, parsed by the same parser a working copy's are.
  const factKeys: Record<string, unknown> = {}
  for (const key of MANIFEST_FACT_KEYS) if (manifest[key] !== undefined) factKeys[key] = manifest[key]
  const facts = parseManifestFacts(factKeys)
  if (!facts.ok) return { ok: false, error: `${PACKAGE_MANIFEST}: ${facts.error}` }

  const title = typeof manifest.title === 'string' && manifest.title.trim() ? manifest.title.trim().slice(0, 80) : name
  const description = typeof manifest.description === 'string' ? manifest.description.trim().slice(0, 280) : ''
  const tags = Array.isArray(manifest.tags) ? manifest.tags.filter((t): t is string => typeof t === 'string') : []
  const rowFacts: Record<string, unknown> = { ...factKeys, surfaces: manifest.surfaces ?? { rail: null, types: [] } }

  const prose: Record<string, unknown> = { type: 'tool', title, ...(description ? { description } : {}), ...(tags.length ? { tags } : {}), version: 0 }
  const docs = (kept['README.md'] ?? '').trim()
  const indexNote = joinFrontmatter(prose, docs ? `${docs}\n` : '')
  const parsed = parseToolConfig({ ...prose, ...rowFacts } as NoteFrontmatter, name)
  if (!parsed.ok) return { ok: false, error: `${PACKAGE_MANIFEST}: ${parsed.error}` }

  return {
    ok: true,
    pkg: {
      name,
      indexNote,
      facts: rowFacts,
      config: parsed.config,
      ui,
      data,
      modules,
      iconSvg: kept['icon.svg'] ?? null,
      releaseNotes: topSection(kept['CHANGELOG.md']),
      version: typeof manifest.version === 'number' && Number.isInteger(manifest.version) ? manifest.version : null,
      publisher,
      checksums,
      signature,
      manifestText,
      ignored: ignored.sort(),
    },
  }
}
