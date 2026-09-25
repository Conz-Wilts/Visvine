/**
 * `.vvtool` packages: the layout a Tool travels in, CHECKSUMS, the zip, what
 * reading one back refuses, and the deployment's signing ring. Pure.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-package.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { parseManifestFacts, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import {
  checksumsText,
  decodePackage,
  encodePackage,
  fileDigests,
  packageDigestOf,
  packageFiles,
  packageManifest,
  parseChecksums,
  readPackageFiles,
  signedMessage,
  PACKAGE_CHECKSUMS,
  PACKAGE_LIMITS,
  PACKAGE_MANIFEST,
  PACKAGE_SIGNATURE,
  type PackageSource,
} from '@/lib/tools/package/shared/layout'
import { publicSigningKeys, signBytes, signingConfigured, verifyBytes } from '@/lib/crypto/signing'

function facts(raw: Record<string, unknown>): ToolManifestFacts {
  const parsed = parseManifestFacts({ manifestVersion: 2, ...raw })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.value
}

const SOURCE: PackageSource = {
  name: 'deal-flow',
  title: 'Deal Flow',
  description: 'A board over the space’s deals.',
  tags: ['crm'],
  surfaces: { rail: { label: 'Deals', icon: 'grid' }, types: [], nav: null, actions: [] },
  facts: facts({
    release: '1.2.0',
    license: 'MIT',
    sdk: '^2.0.0',
    bindings: { deals: { kind: 'folder', label: 'Deal notes', suggest: 'deals' } },
    permissions: { context: { read: ['$deals/**'], write: ['$deals/**'] } },
  }),
  docs: '# Deal Flow\n\nMoves deals along.',
  ui: "import { Stack } from '@visvine/tool-kit'\nexport default function App() {\n  return <Stack />\n}\n",
  data: 'handlers.count = async () => 1\n',
  modules: { 'src/board.tsx': 'export const Board = () => null\n' },
  iconSvg: null,
  changelog: '## 1.2.0\n\nMoves faster.\n\n## 1.1.0\n\nFirst.',
}

/** Zip files as a package would carry them, with CHECKSUMS over the rest. */
function zipped(files: Record<string, string>, withChecksums = true): Uint8Array {
  const all = withChecksums ? { ...files, [PACKAGE_CHECKSUMS]: checksumsText(fileDigests(files)) } : files
  return encodePackage(all)
}

test('a package carries the manifest, the docs, the changelog, the license and every source', () => {
  const files = packageFiles(SOURCE)
  assert.deepEqual(Object.keys(files).sort(), ['CHANGELOG.md', 'LICENSE', 'README.md', 'src/board.tsx', 'src/data.js', 'src/ui.tsx', PACKAGE_MANIFEST].sort())
  const manifest = JSON.parse(files[PACKAGE_MANIFEST]) as Record<string, unknown>
  assert.equal(manifest.manifestVersion, 2)
  assert.equal(manifest.name, 'deal-flow')
  assert.equal(manifest.release, '1.2.0')
  assert.deepEqual(manifest.entry, { ui: 'src/ui.tsx', data: 'src/data.js' })
  assert.equal(manifest.publisher, undefined, 'an unsigned package names no space')
  assert.equal(files.LICENSE, 'SPDX-License-Identifier: MIT\n')
})

test('the manifest reads in a fixed order, and a signed export alone names its publisher', () => {
  const keys = Object.keys(packageManifest(SOURCE))
  assert.deepEqual(keys.slice(0, 5), ['$schema', 'manifestVersion', 'name', 'title', 'description'])
  const signed = packageManifest({ ...SOURCE, publisher: { spaceId: 'acme', name: 'Acme Sales' }, version: 7 })
  assert.deepEqual(signed.publisher, { spaceId: 'acme', name: 'Acme Sales' })
  assert.equal(signed.version, 7)
})

test('CHECKSUMS is sha256sum’s format, sorted, and reads back', () => {
  const digests = fileDigests({ 'b.txt': 'b', 'a.txt': 'a' })
  const text = checksumsText(digests)
  assert.match(text, /^[0-9a-f]{64} {2}a\.txt\n[0-9a-f]{64} {2}b\.txt\n$/)
  assert.deepEqual(parseChecksums(text), digests)
  assert.equal(parseChecksums('not a checksum line'), null)
  assert.equal(packageDigestOf(digests), packageDigestOf(fileDigests({ 'a.txt': 'a', 'b.txt': 'b' })), 'order-free')
})

test('the same files always make the same bytes', () => {
  const files = packageFiles(SOURCE)
  assert.deepEqual(zipped(files), zipped(files))
})

test('a package round-trips into a working copy: prose to the note, facts to the row', () => {
  const decoded = decodePackage(zipped(packageFiles(SOURCE)))
  assert.ok(decoded.ok)
  const read = readPackageFiles(decoded.files)
  assert.ok(read.ok, read.ok ? '' : read.error)
  const pkg = read.pkg
  assert.equal(pkg.name, 'deal-flow')
  assert.match(pkg.indexNote, /^---\ntype: tool\n/)
  assert.match(pkg.indexNote, /Moves deals along\./)
  assert.equal(pkg.config.title, 'Deal Flow')
  assert.deepEqual((pkg.facts.permissions as { context: unknown }).context, { read: ['$deals/**'], write: ['$deals/**'] })
  assert.equal(pkg.data, SOURCE.data)
  assert.deepEqual(pkg.modules, SOURCE.modules)
  assert.equal(pkg.releaseNotes, 'Moves faster.')
  assert.equal(pkg.signature, null)
  assert.ok(pkg.checksums)
})

test('a file changed, added or removed after the package was made is refused', () => {
  const files = packageFiles(SOURCE)
  const good: Record<string, string> = { ...files, [PACKAGE_CHECKSUMS]: checksumsText(fileDigests(files)) }
  const changed = readPackageFiles({ ...good, 'src/ui.tsx': `${files['src/ui.tsx']}// exfiltrate\n` })
  assert.ok(!changed.ok && /src\/ui\.tsx was changed/.test(changed.error))
  const added = readPackageFiles({ ...good, 'src/extra.tsx': 'export {}\n' })
  assert.ok(!added.ok && /added after/.test(added.error))
  const rest = Object.fromEntries(Object.entries(good).filter(([path]) => path !== 'src/board.tsx'))
  const removed = readPackageFiles(rest)
  assert.ok(!removed.ok && /removed after/.test(removed.error))
})

test('sources only: a build, a minified file or code outside src/ is refused; a folder of work is ignored', () => {
  const files = packageFiles(SOURCE)
  const built = readPackageFiles({ ...files, 'src/bundle.js': 'export {}' })
  assert.ok(!built.ok && /not a Tool source/.test(built.error))
  const minified = readPackageFiles({ ...files, 'src/ui.tsx': `export default function A(){${'var a=1;b();c();'.repeat(60)}}` })
  assert.ok(!minified.ok && /minified/.test(minified.error))
  const repo = readPackageFiles({
    ...files,
    'fixtures/deals/acme.md': '# Acme',
    'node_modules/x/index.js': 'x',
    '.github/workflows/check.yml': 'on: push',
    'AGENTS.md': '# rules',
  })
  assert.ok(repo.ok, repo.ok ? '' : repo.error)
  assert.deepEqual(repo.pkg.ignored, ['.github/workflows/check.yml', 'AGENTS.md', 'fixtures/deals/acme.md', 'node_modules/x/index.js'])
})

test('only Visvine names a publisher, and only under its signature', () => {
  const files = packageFiles({ ...SOURCE, publisher: { spaceId: 'acme', name: 'Acme Sales' } })
  const claimed = readPackageFiles(files)
  assert.ok(!claimed.ok && /Only a package Visvine signed/.test(claimed.error))
})

test('the manifest decides the entry, the name and the facts, each checked', () => {
  const files = packageFiles(SOURCE)
  const manifest = JSON.parse(files[PACKAGE_MANIFEST]) as Record<string, unknown>
  const withManifest = (m: Record<string, unknown>) => ({ ...files, [PACKAGE_MANIFEST]: JSON.stringify(m) })
  const entry = readPackageFiles(withManifest({ ...manifest, entry: { ui: 'dist/app.js' } }))
  assert.ok(!entry.ok && /entry\.ui/.test(entry.error))
  const version = readPackageFiles(withManifest({ ...manifest, manifestVersion: 1 }))
  assert.ok(!version.ok)
  const reach = readPackageFiles(withManifest({ ...manifest, permissions: { context: { read: 42 } } }))
  assert.ok(!reach.ok)
  const renamed = readPackageFiles(files, { name: 'pipeline' })
  assert.ok(renamed.ok && renamed.pkg.name === 'pipeline')
  const badName = readPackageFiles(files, { name: 'Deal Flow!' })
  assert.ok(!badName.ok)
})

test('a zip that is not one, or that unpacks too far, is refused before it is read', () => {
  assert.ok(!decodePackage(strToU8('plain text')).ok)
  const bomb = zipSync({ 'src/ui.tsx': [new Uint8Array(PACKAGE_LIMITS.maxPackageBytes + 10), { level: 9 }] })
  const refused = decodePackage(bomb)
  assert.ok(!refused.ok && /unpacks past/.test(refused.error))
  const escape = zipSync({ '../evil.txt': strToU8('x') })
  assert.ok(!decodePackage(escape).ok)
})

test('the signing ring signs under its current key and verifies the retiring one', () => {
  const current = 'a'.repeat(64)
  const previous = 'b'.repeat(64)
  const env = { TOOLS_SIGNING_KEY: current, TOOLS_SIGNING_KEY_PREVIOUS: previous }
  const oldEnv = { TOOLS_SIGNING_KEY: previous }
  const message = signedMessage('abc  x\n', '{}')
  const signed = signBytes(message, env)
  assert.ok(signed)
  assert.ok(verifyBytes(message, signed, env))
  assert.ok(!verifyBytes(`${message} `, signed, env), 'a changed byte fails')
  const byOld = signBytes(message, oldEnv)!
  assert.ok(verifyBytes(message, byOld, env), 'the retiring key still verifies')
  assert.ok(!verifyBytes(message, signed, { TOOLS_SIGNING_KEY: 'c'.repeat(64) }), 'another deployment’s key does not')
  assert.equal(publicSigningKeys(env).length, 2)
  assert.equal(publicSigningKeys(env)[0].keyId, signed.keyId)
})

test('with no key of its own the ring derives one from the secrets key, and with neither it signs nothing', () => {
  const env = { SECRETS_KEY: 'd'.repeat(64) }
  assert.ok(signingConfigured(env))
  const signed = signBytes('x', env)!
  assert.ok(verifyBytes('x', signed, env))
  assert.notEqual(signed.keyId, signBytes('x', { SECRETS_KEY: 'e'.repeat(64) })!.keyId)
  assert.equal(signBytes('x', {}), null)
  assert.ok(!signingConfigured({}))
})

test('a signature travels as a file beside CHECKSUMS and reads back', () => {
  const files = packageFiles({ ...SOURCE, publisher: { spaceId: 'acme', name: 'Acme Sales' } })
  const checksums = checksumsText(fileDigests(files))
  const env = { TOOLS_SIGNING_KEY: 'a'.repeat(64) }
  const signature = signBytes(signedMessage(checksums, files[PACKAGE_MANIFEST]), env)!
  const read = readPackageFiles({
    ...files,
    [PACKAGE_CHECKSUMS]: checksums,
    [PACKAGE_SIGNATURE]: JSON.stringify({ alg: 'ed25519', ...signature, signedAt: '2026-09-26T00:00:00Z' }),
  })
  assert.ok(read.ok, read.ok ? '' : read.error)
  assert.deepEqual(read.pkg.publisher, { spaceId: 'acme', name: 'Acme Sales' })
  assert.ok(read.pkg.signature && verifyBytes(signedMessage(read.pkg.checksums!, read.pkg.manifestText), read.pkg.signature, env))
})
