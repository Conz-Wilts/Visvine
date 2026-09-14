/**
 * Reconcile object storage against the database.
 *
 * The eager purge in ./purge.ts is best-effort by construction — there is no
 * two-phase commit between Postgres and GCS, so an object delete can always be
 * lost to a crash, a rolled-back transaction, or a bucket blip. Deleting
 * eagerly is right because it is immediate and cheap; it is not a guarantee.
 * This is the guarantee: it asks the only question that converges — "is there a
 * live row that claims these bytes?" — and answers it from both sides.
 *
 * It lives in lib/ rather than in the script so the two callers cannot drift:
 * `pnpm db:gc:objects` (report, or delete with --apply) and the nightly sweep
 * (report only, every night, so drift is VISIBLE without anyone remembering to
 * look). A GC you have to remember to run is a GC that reports zero for a year
 * and then reports a surprise.
 */
import prisma from '@/lib/prisma'
import { MEDIA_BUCKET, RESOURCES_BUCKET, deleteObject, listObjects } from '@/lib/gcs'
import { MEDIA_PREFIXES } from './objectPaths'

export interface OrphanObject {
  bucket: string
  name: string
  sizeBytes: number
  /** Why nothing owns it — the row type that should have pointed at it. */
  reason: string
}

export interface AuditReport {
  /** Objects no live row claims, and which are old enough to judge. */
  orphans: OrphanObject[]
  /** Objects under a prefix this module does not recognise. Reported, never deleted. */
  unrecognised: string[]
  /** How many objects were examined across the buckets that were scanned. */
  scanned: number
  /** Skipped as too recent to judge — see `graceMs`. */
  tooRecent: number
  /** Total bytes held by `orphans`. */
  bytes: number
}

export interface AuditOptions {
  /**
   * An object younger than this is never a candidate. An upload writes the
   * OBJECT before it writes the ROW, so without a grace window a sweep running
   * in that gap collects a file somebody is in the middle of uploading — the one
   * way an object GC turns into data loss rather than a cost saving.
   */
  graceMs?: number
  /** Limit the scan to one bucket. */
  only?: 'media' | 'resources'
}

const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000

const EMPTY: AuditReport = {
  orphans: [],
  unrecognised: [],
  scanned: 0,
  tooRecent: 0,
  bytes: 0,
}

/**
 * The resources bucket. Both layouts embed their owning row's key in the path,
 * so the question is answerable exactly: is there a row whose `gcsPath` IS this
 * object? No heuristics, no prefix matching.
 */
async function auditResources(cutoff: number, report: AuditReport): Promise<void> {
  const bucket = RESOURCES_BUCKET()
  const objects = await listObjects(bucket)

  const [resources, sources] = await Promise.all([
    prisma.resource.findMany({ where: { gcsPath: { not: null } }, select: { gcsPath: true } }),
    prisma.contextSource.findMany({ select: { gcsPath: true } }),
  ])
  const owned = new Set<string>()
  for (const r of resources) if (r.gcsPath) owned.add(r.gcsPath)
  for (const s of sources) if (s.gcsPath) owned.add(s.gcsPath)

  for (const obj of objects) {
    report.scanned++
    if (obj.createdMs > cutoff) {
      report.tooRecent++
      continue
    }
    if (owned.has(obj.name)) continue
    const isResource = obj.name.startsWith('resources/')
    const isSource = obj.name.startsWith('context-sources/')
    if (!isResource && !isSource) {
      // An unknown layout is a reason to look, not a reason to delete.
      report.unrecognised.push(`${bucket}/${obj.name}`)
      continue
    }
    report.orphans.push({
      bucket,
      name: obj.name,
      sizeBytes: obj.sizeBytes,
      reason: isResource ? 'no Resource row' : 'no ContextSource row',
    })
    report.bytes += obj.sizeBytes
  }
}

/**
 * The media bucket. Objects are `<prefix>/<entityId>/<variant>.webp`, so the
 * test is whether that entity is still live — a Space for `spaces/`, a Node
 * for the other three.
 *
 * Deliberately does NOT check `imageUrl`: clearing the URL without deleting the
 * bytes is exactly the orphan this exists for, and "the entity exists" is the
 * weaker, safer predicate. This is also the only complete answer for this
 * bucket, because its paths carry no tenant — nothing can enumerate the nodes of
 * a space that has already been deleted.
 */
async function auditMedia(cutoff: number, report: AuditReport): Promise<void> {
  const bucket = MEDIA_BUCKET()
  const objects = await listObjects(bucket)

  const [spaces, nodes] = await Promise.all([
    prisma.space.findMany({ select: { id: true } }),
    prisma.node.findMany({ select: { id: true } }),
  ])
  const liveSpaces = new Set(spaces.map((s) => s.id))
  const liveNodes = new Set(nodes.map((n) => n.id))
  const nodePrefixes = new Set<string>(
    (['card', 'person', 'event'] as const).map((t) => MEDIA_PREFIXES[t]),
  )

  for (const obj of objects) {
    report.scanned++
    if (obj.createdMs > cutoff) {
      report.tooRecent++
      continue
    }
    const [prefix, entityId] = obj.name.split('/')
    if (!prefix || !entityId) {
      report.unrecognised.push(`${bucket}/${obj.name}`)
      continue
    }
    let reason: string | null = null
    if (prefix === MEDIA_PREFIXES.space) {
      if (!liveSpaces.has(entityId)) reason = 'no Space row'
    } else if (nodePrefixes.has(prefix)) {
      if (!liveNodes.has(entityId)) reason = 'no Node row'
    } else {
      report.unrecognised.push(`${bucket}/${obj.name}`)
      continue
    }
    if (!reason) continue
    report.orphans.push({ bucket, name: obj.name, sizeBytes: obj.sizeBytes, reason })
    report.bytes += obj.sizeBytes
  }
}

/** Find every object no live row claims. Reads only — never deletes. */
export async function findOrphanObjects(options: AuditOptions = {}): Promise<AuditReport> {
  const { graceMs = DEFAULT_GRACE_MS, only } = options
  const cutoff = Date.now() - graceMs
  const report: AuditReport = { ...EMPTY, orphans: [], unrecognised: [] }

  if (only !== 'media' && process.env.GCS_RESOURCES_BUCKET) {
    await auditResources(cutoff, report)
  }
  if (only !== 'resources' && process.env.GCS_MEDIA_BUCKET) {
    await auditMedia(cutoff, report)
  }
  return report
}

/** Delete a set of audited orphans. Returns how many were removed. */
export async function deleteOrphans(
  orphans: OrphanObject[],
  onError?: (o: OrphanObject, err: unknown) => void,
): Promise<number> {
  let deleted = 0
  for (const o of orphans) {
    try {
      await deleteObject(o.bucket, o.name)
      deleted++
    } catch (err) {
      onError?.(o, err)
    }
  }
  return deleted
}
