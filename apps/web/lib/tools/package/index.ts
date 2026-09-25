/**
 * `.vvtool` packages in and out (docs/tools.md § Packages; the layout is
 * ./shared/layout.ts).
 *
 *   export   any Tool anyone can read: a working copy under the reader's own
 *            visibility, or a published version wherever its registry detail
 *            is readable. Only a LISTED version's export is signed — with the
 *            deployment's key (lib/crypto/signing.ts) — and names its
 *            publisher; every other export names no space, because a private
 *            space's name must not travel inside a file.
 *   import   a package becomes a NEW working copy in a space, written through
 *            the same service an author uses, and meets every check when it is
 *            published. A signature changes only the provenance shown. What
 *            belongs to the space it came from — versions, installs, state,
 *            collections — stays there.
 */
import prisma from '@/lib/prisma'
import { isSuperAdmin } from '@/lib/session'
import { isActiveMemberOf } from '@/lib/spaces/membership'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { publicSigningKeys, signBytes, signingConfigured, verifyBytes } from '@/lib/crypto/signing'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { CHILDREN_OPEN, stripDuplicateTitleHeading } from '@/lib/notes/shared/indexNote'
import type { ResolvedContext } from '@/lib/notes/resolve'
import { manifestOf, type ToolConfig } from '../config'
import { composeToolIndex } from '../indexFacts'
import { getBuild, toBuildSummary, type BuildSummary } from '../builds'
import { buildFromSources } from '../buildSources'
import { runStaticChecks } from '../checks/analyze'
import type { CheckReport } from '../checks/findings'
import { advisoriesFor } from '../advisories'
import { createTool, deleteToolIcon, describeAuthoredTool, writeToolFile, type ToolFileName } from '../service'
import { bumpIndexVersion, decodeToolConfig, toolKey, versionHistory, type RegistryError } from '../registry'
import { decodeListingState } from '../verdicts'
import {
  checksumsText,
  decodePackage,
  encodePackage,
  fileDigests,
  packageDigestOf,
  packageFiles,
  PACKAGE_CHECKSUMS,
  PACKAGE_EXTENSION,
  PACKAGE_MANIFEST,
  PACKAGE_SIGNATURE,
  packageNotes,
  readPackageFiles,
  signedMessage,
  type PackageRead,
  type PackageSource,
} from './shared/layout'

export type ExportResult =
  | {
      ok: true
      filename: string
      bytes: Uint8Array
      signed: boolean
      /** Named only on a signed export. */
      publisher: { spaceId: string; name: string } | null
      version: number | null
      digest: string
    }
  | RegistryError

/** The changelog a package carries: each version's release notes, newest first, up to this one. */
async function changelogOf(key: string, upTo: number | null): Promise<string | null> {
  const history = await versionHistory(key)
  const sections = history
    .filter((v) => (upTo === null || v.version <= upTo) && v.releaseNotes?.trim() && v.status === 'approved')
    .map((v) => `## ${manifestOf({ perimeter: v.perimeter, manifest: v.manifest }).release ?? `v${v.version}`}\n\n${v.releaseNotes!.trim()}`)
  return sections.length ? sections.join('\n\n') : null
}

function zipOf(src: PackageSource, sign: boolean): { bytes: Uint8Array; digest: string; signed: boolean } {
  const files = packageFiles(src)
  const digests = fileDigests(files)
  const checksums = checksumsText(digests)
  const all: Record<string, string> = { ...files, [PACKAGE_CHECKSUMS]: checksums }
  let signed = false
  if (sign) {
    const signature = signBytes(signedMessage(checksums, files[PACKAGE_MANIFEST]))
    if (signature) {
      all[PACKAGE_SIGNATURE] = `${JSON.stringify({ alg: 'ed25519', ...signature, signedAt: new Date().toISOString() }, null, 2)}\n`
      signed = true
    }
  }
  return { bytes: encodePackage(all), digest: packageDigestOf(digests), signed }
}

/** A working copy, as the reader may see it. Never signed. */
export async function exportWorkingCopy(p: ContextPrincipal, context: Context, name: string): Promise<ExportResult> {
  const tool = await describeAuthoredTool(p, context, name)
  if (!tool) return { ok: false, status: 404, error: `No tool named "${name}" here.` }
  if (!tool.config) return { ok: false, status: 409, error: `${name}'s index note does not parse — fix it, then export.` }
  const ui = tool.sources['ui.tsx']
  if (ui === null) return { ok: false, status: 409, error: `${name} has no ui.tsx to export.` }
  const build = await getBuild(context.spaceId, name)
  const config: ToolConfig = tool.config
  const src: PackageSource = {
    name,
    title: config.title,
    description: config.description,
    tags: config.tags,
    surfaces: config.surfaces,
    facts: manifestOf(config),
    docs: splitFrontmatter(tool.sources['index.md'] ?? '').body,
    ui,
    data: tool.sources['data.js'],
    modules: tool.modules,
    iconSvg: build?.iconSvg ?? null,
    changelog: await changelogOf(toolKey(context.spaceId, name), null),
  }
  const zip = zipOf(src, false)
  return { ok: true, filename: `${name}${PACKAGE_EXTENSION}`, bytes: zip.bytes, signed: false, publisher: null, version: null, digest: zip.digest }
}

/** A version's package source — what its digests are taken over, and what an export zips. */
async function versionSource(versionId: string) {
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: {
      key: true,
      name: true,
      version: true,
      title: true,
      description: true,
      config: true,
      indexSource: true,
      uiSource: true,
      dataSource: true,
      modules: true,
      iconSvg: true,
      tags: true,
      status: true,
      marketplaceStatus: true,
      revokedAt: true,
      sourceSpaceId: true,
      authorUserId: true,
      listingId: true,
      digests: true,
    },
  })
  if (!row) return null
  const config = decodeToolConfig(row.config, row.name)
  const modules =
    row.modules && typeof row.modules === 'object' && !Array.isArray(row.modules)
      ? Object.fromEntries(Object.entries(row.modules as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : {}
  const src: PackageSource = {
    name: row.name,
    title: config.title || row.title,
    description: config.description || row.description || '',
    tags: row.tags,
    surfaces: config.surfaces,
    facts: manifestOf(config),
    docs: row.indexSource,
    ui: row.uiSource,
    data: row.dataSource || null,
    modules,
    iconSvg: row.iconSvg,
    changelog: await changelogOf(row.key, row.version),
    version: row.version,
  }
  return { row, src }
}

/**
 * Each file's SHA-256 and the package's, stored on a version once — the
 * canonical package, naming no publisher, so a signed export and an unsigned
 * one of the same version carry the same sources under the same digests.
 */
export async function storeVersionDigests(versionId: string): Promise<string | null> {
  const found = await versionSource(versionId)
  if (!found) return null
  const digests = fileDigests(packageFiles(found.src))
  const packageDigest = packageDigestOf(digests)
  await prisma.appToolVersion.update({ where: { id: versionId }, data: { digests, packageDigest } })
  return packageDigest
}

/** A published version. Signed, naming its publisher, when Visvine lists it. */
export async function exportVersion(versionId: string, viewer: { userId: string; email: string }): Promise<ExportResult> {
  const found = await versionSource(versionId)
  if (!found) return { ok: false, status: 404, error: 'No such tool version.' }
  const { row, src } = found
  const listed = row.status === 'approved' && row.marketplaceStatus === 'approved' && !row.revokedAt
  const readable =
    listed ||
    isSuperAdmin(viewer.email) ||
    row.authorUserId === viewer.userId ||
    (await isActiveMemberOf(viewer.userId, row.sourceSpaceId))
  // The same answer for absent and unreadable, as the registry gives.
  if (!readable) return { ok: false, status: 404, error: 'No such tool version.' }

  let publisher: { spaceId: string; name: string } | null = null
  if (listed && signingConfigured()) {
    const listing = row.listingId
      ? await prisma.appToolListing.findUnique({ where: { id: row.listingId }, select: { state: true, publisherSpaceId: true } })
      : null
    if (listing && decodeListingState(listing.state) === 'active') {
      const space = await prisma.space.findUnique({ where: { id: listing.publisherSpaceId }, select: { name: true } })
      if (space) publisher = { spaceId: listing.publisherSpaceId, name: space.name }
    }
  }
  if (!row.digests || Object.keys(row.digests as object).length === 0) await storeVersionDigests(versionId)
  const zip = zipOf(publisher ? { ...src, publisher } : src, publisher !== null)
  return {
    ok: true,
    filename: `${row.name}-v${row.version}${PACKAGE_EXTENSION}`,
    bytes: zip.bytes,
    signed: zip.signed,
    publisher: zip.signed ? publisher : null,
    version: row.version,
    digest: zip.digest,
  }
}

export type ImportResult =
  | {
      ok: true
      name: string
      /** The package's own name, when it was taken here and the copy took the next free one. */
      renamedFrom: string | null
      /** Set when Visvine's signature on it checked out: who published it, and as what. */
      provenance: { publisher: string; release: string | null; version: number | null } | null
      /** A signature was there but is not this deployment's — imported as unsigned. */
      unverifiedSignature: boolean
      ignored: string[]
      buildOk: boolean
      /** Files that could not be written, each with why. */
      problems: string[]
    }
  | RegistryError

/** A package into a space, as a new working copy the importer authored. */
export async function importPackage(
  p: ContextPrincipal,
  context: Context,
  bytes: Uint8Array,
  opts: { name?: string } = {},
): Promise<ImportResult> {
  const decoded = decodePackage(bytes)
  if (!decoded.ok) return { ok: false, status: 400, error: decoded.error }
  const read = readPackageFiles(decoded.files, opts)
  if (!read.ok) return { ok: false, status: 400, error: read.error }
  const pkg = read.pkg

  let provenance: { publisher: string; release: string | null; version: number | null } | null = null
  let unverifiedSignature = false
  if (pkg.signature && pkg.checksums) {
    if (verifyBytes(signedMessage(pkg.checksums, pkg.manifestText), pkg.signature) && pkg.publisher) {
      provenance = { publisher: pkg.publisher.name, release: pkg.config.manifest?.release ?? null, version: pkg.version }
    } else {
      unverifiedSignature = true
    }
  }

  // A Tool's name is its node's id across the deployment, so the name a
  // package carries may be taken — by the space it came from, most often.
  // Asked for by name, that is the answer; otherwise the copy takes the next
  // free one and says so.
  let name = pkg.name
  let created = await createTool(p, context, { name, title: pkg.config.title, description: pkg.config.description })
  for (let n = 2; !created.ok && created.status === 409 && !opts.name && n <= 20; n++) {
    name = `${pkg.name}-${n}`.slice(0, 63)
    created = await createTool(p, context, { name, title: pkg.config.title, description: pkg.config.description })
  }
  if (!created.ok) return created

  const problems: string[] = []
  const writes: Array<[ToolFileName, string]> = [
    ['index.md', composeToolIndex(pkg.indexNote, pkg.facts)],
    ['ui.tsx', pkg.ui],
    ['data.js', pkg.data ?? ''],
    ...Object.entries(pkg.modules).map(([file, code]) => [file as ToolFileName, code] as [ToolFileName, string]),
    ...(pkg.iconSvg ? [['icon.svg', pkg.iconSvg] as [ToolFileName, string]] : []),
  ]
  let buildOk = created.build.ok
  for (const [file, content] of writes) {
    const written = await writeToolFile(p, context, name, file, content)
    if (!written.ok) problems.push(`${file}: ${written.error}`)
    else buildOk = written.build.ok
  }
  return {
    ok: true,
    name,
    renamedFrom: name === pkg.name ? null : pkg.name,
    provenance,
    unverifiedSignature,
    ignored: pkg.ignored,
    buildOk,
    problems,
  }
}

// ── pushing ─────────────────────────────────────────────────────────────────

/**
 * Build a package the way the server builds a working copy — the same
 * `buildFromSources`, over the package's files instead of notes, saved nowhere.
 */
async function buildInMemory(pkg: PackageRead): Promise<BuildSummary> {
  const notes = packageNotes(pkg)
  const built = await buildFromSources(pkg.name, {
    index: notes.index,
    ui: notes.ui,
    data: notes.data,
    icon: notes.icon,
    folder: `tools/${pkg.name}`,
    modules: notes.modules,
  })
  return { ...built, updatedAt: new Date().toISOString(), sourceHash: '' }
}

export type CheckPackageResult =
  | { ok: true; name: string; build: BuildSummary; report: CheckReport; ignored: string[] }
  | RegistryError

/**
 * A package built and checked — the compile and the static stages a push and
 * a publish would run — with nothing written anywhere.
 */
export async function checkPackage(bytes: Uint8Array, opts: { name?: string } = {}): Promise<CheckPackageResult> {
  const decoded = decodePackage(bytes)
  if (!decoded.ok) return { ok: false, status: 400, error: decoded.error }
  const read = readPackageFiles(decoded.files, opts)
  if (!read.ok) return { ok: false, status: 400, error: read.error }
  const pkg = read.pkg
  const build = await buildInMemory(pkg)
  const config = build.config ?? pkg.config
  const report = await runStaticChecks({
    index: packageNotes(pkg).index,
    ui: pkg.ui,
    data: pkg.data,
    modules: pkg.modules,
    config,
    build: { ok: build.ok, errors: build.errors, warnings: build.warnings, configError: build.configError },
    advisories: await advisoriesFor(Object.keys(manifestOf(config).dependencies)),
  })
  return { ok: true, name: pkg.name, build, report, ignored: pkg.ignored }
}

export type PushResult =
  | {
      ok: true
      name: string
      /** It did not exist here, and the push made it. */
      created: boolean
      /** The files the push wrote, and the ones it removed. */
      changed: string[]
      removed: string[]
      build: BuildSummary | null
      ignored: string[]
    }
  | RegistryError

/** A value with every object's keys in one order — the facts row is JSONB, which keeps its own. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]))
  }
  return value
}

/**
 * Two index notes that say the same thing: the same frontmatter in any key
 * order, the same docs — beside what the store keeps on every index itself
 * (its `node:`, the child list it maintains, no heading repeating the title).
 */
function sameIndex(a: string | null, b: string): boolean {
  if (a === null) return false
  const norm = (text: string) => {
    const { node: _node, ...frontmatter } = parseFrontmatter(text) as Record<string, unknown>
    const body = splitFrontmatter(text).body
    const at = body.indexOf(CHILDREN_OPEN)
    const docs = stripDuplicateTitleHeading(at === -1 ? body : body.slice(0, at), String(frontmatter.title ?? ''))
    return `${JSON.stringify(sortedKeys(frontmatter))}\n${docs.trim()}`
  }
  return norm(a) === norm(b)
}

/** The same source, as a note keeps it — its trailing whitespace is the note's, not the code's. */
function sameSource(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === null ? (b ?? null) === null : (b ?? null) !== null && a!.trimEnd() === b!.trimEnd()
}

/**
 * A package into a space as a working copy — made when the space has no Tool
 * of its name, brought in line with it when it has one the pusher may edit.
 * Only what changed is written, each file through the author's own service
 * and gates; a module or an icon the package no longer carries is removed.
 * Unlike an import, a push never takes another name: the name is the
 * author's, and one taken elsewhere is refused for them to change.
 */
export async function pushPackage(
  p: ContextPrincipal,
  context: Context,
  bytes: Uint8Array,
  opts: { name?: string } = {},
): Promise<PushResult> {
  const decoded = decodePackage(bytes)
  if (!decoded.ok) return { ok: false, status: 400, error: decoded.error }
  const read = readPackageFiles(decoded.files, opts)
  if (!read.ok) return { ok: false, status: 400, error: read.error }
  const pkg = read.pkg
  const name = pkg.name

  let current = await describeAuthoredTool(p, context, name)
  let created = false
  if (!current) {
    const made = await createTool(p, context, { name, title: pkg.config.title, description: pkg.config.description })
    if (!made.ok) {
      if (made.status === 409) return { ok: false, status: 409, error: `The name "${name}" is taken — choose another in ${PACKAGE_MANIFEST}.` }
      return made
    }
    created = true
    current = await describeAuthoredTool(p, context, name)
    if (!current) return { ok: false, status: 500, error: `${name} was made but cannot be read back.` }
  }

  // The registry's number is the space's, written back on each publish; a
  // package's own says nothing about this space's versions.
  const existingVersion = Number(parseFrontmatter(current.sources['index.md'] ?? '').version) || 0
  const index = composeToolIndex(bumpIndexVersion(pkg.indexNote, existingVersion) ?? pkg.indexNote, pkg.facts)

  const writes: Array<[ToolFileName, string]> = []
  if (!sameIndex(current.sources['index.md'], index)) writes.push(['index.md', index])
  for (const [file, code] of Object.entries(pkg.modules)) {
    if (!sameSource(current.modules[file], code)) writes.push([file as ToolFileName, code])
  }
  const removedModules = Object.keys(current.modules).filter((file) => !(file in pkg.modules))
  const data = pkg.data?.trim() ? pkg.data : null
  const hadData = current.sources['data.js']?.trim() ? current.sources['data.js'] : null
  if (!sameSource(hadData, data)) writes.push(['data.js', data ?? ''])
  if (pkg.iconSvg !== null && !sameSource(current.sources['icon.svg'], pkg.iconSvg)) writes.push(['icon.svg', pkg.iconSvg])
  // ui.tsx last: modules first, so the entry's imports resolve when it rebuilds.
  if (!sameSource(current.sources['ui.tsx'], pkg.ui)) writes.push(['ui.tsx', pkg.ui])

  const changed: string[] = []
  const removed: string[] = []
  let build: BuildSummary | null = null
  for (const file of removedModules) {
    const written = await writeToolFile(p, context, name, file as ToolFileName, '')
    if (!written.ok) return { ok: false, status: written.status, error: `${file}: ${written.error}` }
    removed.push(file)
    build = written.build
  }
  for (const [file, content] of writes) {
    const written = await writeToolFile(p, context, name, file, content)
    if (!written.ok) return { ok: false, status: written.status, error: `${file}: ${written.error}` }
    changed.push(file)
    build = written.build
  }
  if (pkg.iconSvg === null && current.sources['icon.svg'] !== null) {
    const cleared = await deleteToolIcon(p, context as ResolvedContext, name)
    if (!cleared.ok) return { ok: false, status: cleared.status, error: `icon.svg: ${cleared.error}` }
    removed.push('icon.svg')
    build = cleared.build
  }
  if (!build) {
    const row = await getBuild(context.spaceId, name)
    build = row ? toBuildSummary(row) : null
  }
  return { ok: true, name, created, changed, removed, build, ignored: pkg.ignored }
}

/** The keys that verify Visvine's signatures, for anyone checking a package offline. */
export function signingKeys() {
  return publicSigningKeys()
}
