import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MEDIA_PREFIXES,
  NODE_MEDIA_TYPES,
  contextSourceObjectPath,
  contextSourcesPrefix,
  mediaPrefix,
  mediaPrefixBare,
  resourceObjectPath,
  spaceContextSourcesPrefix,
  spaceResourcesPrefix,
} from '@/lib/storage/objectPaths'

/**
 * The tier-3 invariant, made checkable.
 *
 * docs/data-architecture.md §1 gives object storage the rule "bytes have exactly
 * one owner", and bulk deletes broke it: dropping a space or closing an account
 * removed the rows and left the objects, because the only code that knew how to
 * delete bytes was reached one row at a time. The fix expresses a tenant's bytes
 * as a PREFIX, which is only sound if every path this app mints actually begins
 * with the tenant that owns it. That is the property these tests hold — it has
 * to be checked, not assumed, because it is what stops a prefix delete from
 * reaching across a tenant boundary.
 */

const root = join(__dirname, '..')

test('every resources-bucket path begins with its space prefix', () => {
  const spaceId = 'community:acme'
  assert.ok(resourceObjectPath(spaceId, 'uuid-1', 'deck.pdf').startsWith(spaceResourcesPrefix(spaceId)))
  assert.ok(
    contextSourceObjectPath(spaceId, 'shared', 'src-1', 'pricing.csv').startsWith(
      spaceContextSourcesPrefix(spaceId),
    ),
  )
})

test('a context prefix sits inside its space prefix', () => {
  const spaceId = 'community:acme'
  assert.ok(contextSourcesPrefix(spaceId, 'user_7').startsWith(spaceContextSourcesPrefix(spaceId)))
  // …and a person's personal-context prefix contains their own originals only,
  // which is what makes account deletion expressible as one prefix per space.
  assert.ok(
    contextSourceObjectPath(spaceId, 'user_7', 'src-1', 'notes.csv').startsWith(
      contextSourcesPrefix(spaceId, 'user_7'),
    ),
  )
})

test('one space prefix never reaches another whose id shares a prefix', () => {
  // `resources/sp1` would match `resources/sp10` without the trailing separator.
  // This is the whole reason the helpers return a slash-terminated prefix.
  assert.ok(spaceResourcesPrefix('sp1').endsWith('/'))
  assert.ok(!spaceResourcesPrefix('sp10').startsWith(spaceResourcesPrefix('sp1')))
  assert.ok(!contextSourcesPrefix('sp', 'user_1').startsWith(contextSourcesPrefix('sp', 'user_10')))
  assert.ok(!mediaPrefix('card', 'n1').startsWith(mediaPrefix('card', 'n10')))
})

test('an id containing a separator is refused, not silently joined', () => {
  // An id is internal, but this is the one place a bad one stops being a 404 and
  // becomes an authorization boundary: `../other-space` inside an id would let a
  // purge or a signed URL address a different tenant's subtree.
  assert.throws(() => spaceResourcesPrefix('sp/../other'), /must not contain/)
  assert.throws(() => contextSourcesPrefix('sp', 'user/../shared'), /must not contain/)
  assert.throws(() => mediaPrefix('card', 'a/b'), /must not contain/)
})

test('an empty id is refused', () => {
  assert.throws(() => spaceResourcesPrefix(''), /required/)
  assert.throws(() => contextSourcesPrefix('sp', ''), /required/)
  assert.throws(() => mediaPrefix('space', '   '), /required/)
})

test('the bare media prefix is the slashed one without its separator', () => {
  for (const type of [...NODE_MEDIA_TYPES, 'space' as const]) {
    assert.equal(`${mediaPrefixBare(type, 'e1')}/`, mediaPrefix(type, 'e1'))
  }
})

test('media prefixes are distinct per entity kind', () => {
  const values = Object.values(MEDIA_PREFIXES)
  assert.equal(new Set(values).size, values.length)
})

test('deleteObjectsByPrefix refuses an empty prefix', () => {
  // `deleteFiles({ prefix: '' })` empties the bucket. Every caller builds its
  // prefix from an id, and a bug that leaves one blank must fail loudly rather
  // than delete everything — a guard that costs nothing beats an argument that
  // it cannot happen.
  const gcs = readFileSync(join(root, 'lib/gcs.ts'), 'utf8')
  assert.match(gcs, /requires a non-empty prefix/)
})

test('both bulk delete paths purge bytes', () => {
  // The two places that remove many byte-owning rows at once. Each used
  // deleteMany, which never reaches the service that owns the objects, so each
  // one leaked every file of every space or account it removed.
  const spaceRoute = readFileSync(join(root, 'app/api/data/communities/route.ts'), 'utf8')
  const account = readFileSync(join(root, 'lib/account/deleteAccount.ts'), 'utf8')
  assert.match(spaceRoute, /purgeSpaceObjects\(/)
  assert.match(account, /purgeSpaceObjects\(/)
  assert.match(account, /purgePersonalContextObjects\(/)
})

test('object paths are minted in exactly one module', () => {
  // The prefix guarantee above is only worth anything if nothing builds a path
  // by hand. These are the three sites that used to, each with its own literal.
  const service = readFileSync(join(root, 'lib/resources/service.ts'), 'utf8')
  const ingest = readFileSync(join(root, 'lib/notes/sources/ingest.ts'), 'utf8')
  const upload = readFileSync(join(root, 'app/api/upload/route.ts'), 'utf8')

  assert.match(service, /resourceObjectPath\(/)
  assert.doesNotMatch(service, /`resources\/\$\{/)
  assert.match(ingest, /contextSourceObjectPath\(/)
  assert.doesNotMatch(ingest, /`context-sources\/\$\{/)
  assert.match(upload, /mediaPrefixBare\(/)
})

test('every node-deletion path purges the node images first', () => {
  // A node's images live under its own id, so once the row is gone nothing can
  // attribute the bytes except the reconciliation sweep. Each of these deleted
  // the row and left the images, for the same reason the bulk paths did: the
  // deletion path did not know buckets existed.
  const sites: Array<[string, string]> = [
    ['app/api/data/nodes/route.ts', 'prisma.node.deleteMany'],
    ['lib/eventRepo.ts', 'prisma.node.deleteMany'],
    ['lib/notes/context/entityNodes.ts', 'prisma.node.delete('],
    ['lib/account/deleteAccount.ts', 'tx.node.deleteMany'],
  ]
  for (const [file, deletion] of sites) {
    const src = readFileSync(join(root, file), 'utf8')
    const purge = src.indexOf('purgeNodeObjects(')
    const del = src.indexOf(deletion)
    assert.ok(purge > 0, `${file} deletes nodes but never purges their images`)
    assert.ok(del > 0, `${file}: expected ${deletion}`)
    assert.ok(purge < del, `${file}: images must be purged BEFORE the node row is deleted`)
  }
})

test('the reconciliation sweep reports before it deletes', () => {
  // A GC sweep that deletes on a typo is worse than no GC sweep, and a sweep
  // with no grace window collects the object of an upload that is mid-flight —
  // the upload writes the object before it writes the row.
  const gc = readFileSync(join(root, 'scripts/gc-orphan-objects.ts'), 'utf8')
  const audit = readFileSync(join(root, 'lib/storage/audit.ts'), 'utf8')
  assert.match(gc, /flag\('apply'\)/, 'deleting must be opt-in')
  assert.match(gc, /Re-run with --apply/, 'the default run must say it changed nothing')
  assert.match(
    audit,
    /createdMs > cutoff/,
    'the audit must skip objects newer than the grace window — an upload writes bytes before the row',
  )
  assert.match(audit, /DEFAULT_GRACE_MS/, 'there must be a default grace window, not an opt-in one')
})

test('the audit runs nightly, and never deletes when it does', () => {
  // A GC you have to remember to run reports zero for a year and then reports a
  // surprise. The nightly pass is what makes drift visible; deleting stays a
  // deliberate human act, so the scheduled caller must not be able to remove
  // anything.
  const nightly = readFileSync(join(root, 'lib/notes/nightly.ts'), 'utf8')
  assert.match(nightly, /findOrphanObjects\(/, 'the nightly sweep must audit storage')
  assert.doesNotMatch(
    nightly,
    /deleteOrphans|deleteObjectsByPrefix|deleteObject\(/,
    'the nightly pass must never delete objects — that is db:gc:objects --apply',
  )
  assert.match(nightly, /storage_drift/, 'drift must be logged loudly enough to notice')
})

test('the audit is shared by both callers rather than reimplemented', () => {
  // The script used to own the comparison. Two copies of "is this object
  // orphaned" drift, and the copy that drifts is the one that deletes.
  const gc = readFileSync(join(root, 'scripts/gc-orphan-objects.ts'), 'utf8')
  assert.match(gc, /from '\.\.\/lib\/storage\/audit'/)
  assert.doesNotMatch(gc, /prisma\.resource\.findMany/, 'the script must not re-derive ownership')
  assert.doesNotMatch(gc, /prisma\.node\.findMany/)
})
