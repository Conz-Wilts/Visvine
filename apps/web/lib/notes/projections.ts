/**
 * The note write path's transactional OUTBOX.
 *
 * docs/data-architecture.md §1 promises that every tier-2 projection is
 * "rebuildable by replaying tier 1". Six subsystems depend on that promise —
 * directory links derived from `[[mentions]]`, `AgentState` parsed from the live
 * note, `AppToolBuild` compiled from a Tool's sources, the space-config columns,
 * published replicas, and folder index notes. Until this module the promise had
 * nothing behind it: `store.ts` committed the note row and then ran the six as
 * bare awaits, outside any transaction, with no record anywhere that they were
 * owed. A crash between the commit and the last hook, a deploy mid-save, or one
 * hook throwing left the declaration stored and its projections stale — silently,
 * and with no way to even enumerate the damage.
 *
 * The fix is one row. `enqueueProjection` writes a `NoteProjectionJob` in the
 * SAME transaction as the note itself, so "this note changed" and "its
 * projections are owed" commit together or not at all. `settleProjection` then
 * runs them inline (the author still sees their Tool's compile errors on save,
 * which is why this is not a background queue) and deletes the row on success.
 * Anything that fails, or never got to run, stays on the table and is retried by
 * `drainProjections` with exponential backoff.
 *
 * Three properties make this safe:
 *
 * - **Idempotent hooks.** Every projection on the path was already written to
 *   tolerate a re-run — the link sync re-derives from scratch, the Tool build
 *   skips by content hash, the config projection compares before writing,
 *   publications no-op when the replica already matches. Replay is at worst
 *   wasted compute.
 * - **No content on the job.** A retry re-reads the note and projects what it
 *   says NOW. A job that lands after three further edits converges on the truth
 *   instead of replaying a stale snapshot, and the row stays small.
 * - **Convergent staleness.** A `write` job whose note is no longer at that path
 *   is a no-op, not a guess: whatever moved or trashed it enqueued its own job,
 *   and that job is authoritative for the path.
 *
 * What is deliberately NOT here: the structural half of a mutation — moving
 * grants and folder flags on a rename, flipping `deletedAt` on a trash. Those
 * are part of the write, must happen exactly once, and stay inline in the store.
 * Only *derived* state is replayable, which is the whole distinction §1 draws
 * between a projection and a ledger.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { logger } from '@/lib/logger'
import { syncContextLinks, syncContextLinksBulk } from './entityLinks'
import { agentNoteDeleted, agentNoteRenamed, agentNoteWritten } from '@/lib/agents/hooks'
import { toolNoteDeleted, toolNoteRenamed, toolNoteWritten } from '@/lib/tools/hooks'
import { globalNoteWritten } from '@/lib/global/hooks'
import {
  syncPublicationsOnDelete,
  syncPublicationsOnRename,
  syncPublicationsOnWrite,
} from './publications'
import type { Actor, Context } from './store'
import type { NoteRevisionOrigin } from './shared/types'

type ProjectionKind = 'write' | 'rename' | 'delete'

/** Everything a projection replay needs, and nothing it can go stale on. */
export interface ProjectionInput {
  context: Context
  path: string
  kind: ProjectionKind
  /** Rename only: the path the note moved off. */
  fromPath?: string
  origin: NoteRevisionOrigin
  actor: Actor
  model?: string
  /** Whether the save actually changed the content (drives the agent hook). */
  changed?: boolean
}

/** How many times a job is retried before it is parked as poison. */
const MAX_ATTEMPTS = 8
/** First retry delay; doubles per attempt up to the cap. */
const BASE_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 60 * 60_000
/** Jobs claimed per drain pass — bounded so a tick can't run away. */
const DRAIN_BATCH = 50

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
}

/**
 * A Prisma client or an interactive-transaction client. `enqueueProjection` is
 * always called with the latter — enqueueing outside the note's own transaction
 * would reintroduce exactly the gap this module exists to close.
 */
type Db = Prisma.TransactionClient | typeof prisma

/**
 * Record that `path`'s projections are owed. MUST run in the same transaction as
 * the note mutation it describes.
 *
 * Consecutive `write` jobs for one path coalesce onto the pending row rather than
 * stacking: a note autosaved five times while the drain is behind owes ONE
 * rebuild, not five, and since no content rides on the job the surviving row
 * projects the latest text anyway. Renames and deletes never coalesce — each
 * names a distinct path transition that has to be applied on its own.
 */
export async function enqueueProjection(db: Db, input: ProjectionInput): Promise<string> {
  const { context, path, kind, fromPath, origin, actor, model, changed = true } = input
  const data = {
    spaceId: context.spaceId,
    ownerKey: context.ownerKey,
    path,
    kind,
    fromPath: fromPath ?? null,
    origin,
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email ?? null,
    model: model ?? null,
    changed,
  }

  if (kind === 'write') {
    const pending = await db.noteProjectionJob.findFirst({
      where: {
        spaceId: context.spaceId,
        ownerKey: context.ownerKey,
        path,
        kind: 'write',
        doneAt: null,
      },
      select: { id: true },
    })
    if (pending) {
      await db.noteProjectionJob.update({
        where: { id: pending.id },
        // `changed` is sticky: if ANY save in the coalesced window changed the
        // content, the rebuild must treat it as a real edit — that is what the
        // agent hook's auto-deactivate rule keys on.
        data: { ...data, changed: changed || undefined, runAfter: new Date(), lastError: null },
      })
      return pending.id
    }
  }

  const row = await db.noteProjectionJob.create({ data, select: { id: true } })
  return row.id
}

/** The note's current content at this path, or null when nothing lives there. */
async function liveContent(context: Context, path: string): Promise<string | null> {
  const row = await prisma.contextNote.findFirst({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path, deletedAt: null },
    select: { content: true },
  })
  return row?.content ?? null
}

/**
 * Drop the vector for a path that no longer holds a live note.
 *
 * `ContextNoteEmbedding` is keyed by (space_id, owner_key, path) with no foreign
 * key — it cannot have one, since a note's identity is a unique constraint
 * rather than its primary key. So nothing in the database removes these, and
 * before this nothing in the code did either: the sweep only ever upserted, so
 * every delete and every rename left a vector behind permanently.
 *
 * It was contained rather than dangerous — the vector stage intersects its
 * results with the live candidate paths, so a stale row could never surface a
 * deleted note — but a folder rename meant paying to embed every note again
 * while the old vectors stayed forever.
 *
 * A projection, and idempotent, so it belongs on this path: deleting a row that
 * is already gone is a no-op, and a delete that never ran is repaired by the
 * nightly sweep's orphan pass (lib/notes/embedSweep.ts) rather than lost.
 */
export async function dropEmbedding(context: Context, path: string): Promise<void> {
  const where = { spaceId: context.spaceId, ownerKey: context.ownerKey, path }
  await prisma.contextNoteEmbedding.deleteMany({ where })
  // The derived memories and the note's chunks are keyed the same way and die
  // with the note for the same reason; the nightly sweep (memorySweep.ts,
  // embedSweep.ts) reconciles misses.
  await prisma.contextMemory.deleteMany({ where })
  await prisma.contextNoteChunk.deleteMany({ where })
}

/**
 * Rebuild every projection derived from one note mutation. Idempotent by
 * construction — this is the function a retry, a drain and a full reconcile all
 * call, and calling it twice in a row must be indistinguishable from calling it
 * once.
 *
 * The folder-index pass is imported lazily: `store.ts` imports this module, so a
 * value import back would close the cycle at module scope. Deferring it to call
 * time is the same trick the space-config split uses, and keeps the module graph
 * acyclic on load.
 */
async function applyProjections(input: ProjectionInput): Promise<void> {
  const { context, path, kind, fromPath, origin, actor, model, changed = true } = input
  const store = await import('./store')

  if (kind === 'delete') {
    await syncContextLinks(context, path, null) // a trashed note owns no context links
    await syncPublicationsOnDelete(context, [path])
    await store.refreshIndexesForNote(context, path)
    await agentNoteDeleted(context, path)
    await toolNoteDeleted(context, path)
    await dropEmbedding(context, path)
    return
  }

  if (kind === 'rename') {
    const from = fromPath
    if (!from || from === path) return
    const content = await liveContent(context, path)
    // Renamed away again since this job was written; the later rename's own job
    // owns the current path. Nothing to converge on here.
    if (content === null) return
    await syncContextLinksBulk(context, [from], [[path, content]])
    await syncPublicationsOnRename(context, from, path)
    await store.refreshIndexesForNote(context, from)
    await store.refreshIndexesForNote(context, path)
    await agentNoteRenamed(context, from, path, actor, { origin, model })
    await toolNoteRenamed(context, from, path)
    await dropEmbedding(context, from)
    return
  }

  const content = await liveContent(context, path)
  // The note moved or was trashed after this job was enqueued. The mutation that
  // did so enqueued its own job and is authoritative for the path — replaying a
  // write against an empty path would be a guess, so this is a no-op.
  if (content === null) return

  await syncContextLinks(context, path, content)
  await agentNoteWritten(context, path, actor, { changed, origin, model })
  await toolNoteWritten(context, path)
  // Origin 'publish' IS a replica write; skipping it is what stops replication
  // cascades and publish cycles dead.
  if (origin !== 'publish') await syncPublicationsOnWrite(context, path, content, actor)
  await globalNoteWritten(context, path, origin)
  await store.ensureAncestorIndexes(context, path, actor)
  await store.refreshIndexesForNote(context, path)
}

/**
 * Run a freshly-enqueued job's projections inline and settle the row.
 *
 * Inline on purpose. Moving the fan-out to a background worker would be the
 * obvious "queue" design and would be wrong here: a Tool author expects compile
 * errors on save, a mention expects its edge immediately, and an activation
 * expects the schedule to be live when the page reloads. What the outbox buys is
 * not asynchrony — it is that a failure is now RECORDED and RETRIED instead of
 * vanishing into a `void`.
 *
 * Never throws: a projection failure must not fail the save that already
 * committed. The row is what carries the failure forward.
 */
export async function settleProjection(jobId: string, input: ProjectionInput): Promise<void> {
  try {
    await applyProjections(input)
    await prisma.noteProjectionJob.deleteMany({ where: { id: jobId } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('notes.projection.failed', {
      jobId,
      spaceId: input.context.spaceId,
      path: input.path,
      kind: input.kind,
      err: message,
    })
    await prisma.noteProjectionJob
      .updateMany({
        where: { id: jobId, doneAt: null },
        data: {
          attempts: 1,
          lastError: message.slice(0, 1000),
          runAfter: new Date(Date.now() + backoffMs(1)),
        },
      })
      .catch(() => {
        /* the DB is the thing that's unhappy; the drain will find the row */
      })
  }
}

/**
 * The bulk counterpart of `settleProjection`, for the folder-level mutators.
 *
 * A folder rename touches every note under it, and the store fans those out in
 * BATCHES — one bulk link resync, one round of parallel publication updates —
 * which is meaningfully faster than N single-note passes and handles
 * cross-references between the moved notes that a per-note loop would miss. So
 * the batch keeps its own fan-out and this only wraps it: the job rows were
 * enqueued with the path updates and are pure insurance, deleted together when
 * the batch succeeds and left for the drain (which repairs them one note at a
 * time) when it does not.
 */
export async function settleBatch(jobIds: string[], run: () => Promise<void>): Promise<void> {
  try {
    await run()
    if (jobIds.length) await prisma.noteProjectionJob.deleteMany({ where: { id: { in: jobIds } } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('notes.projection.batchFailed', { jobs: jobIds.length, err: message })
    await prisma.noteProjectionJob
      .updateMany({
        where: { id: { in: jobIds }, doneAt: null },
        data: {
          attempts: 1,
          lastError: message.slice(0, 1000),
          runAfter: new Date(Date.now() + backoffMs(1)),
        },
      })
      .catch(() => {})
  }
}

export interface DrainReport {
  claimed: number
  succeeded: number
  failed: number
  parked: number
}

/**
 * Retry the projections nobody settled — the crash-recovery half of the outbox.
 *
 * Claims each due row by compare-and-swap on `attempts`, so two instances
 * draining at the same minute cannot both run one job. A row that has burned
 * MAX_ATTEMPTS is PARKED (settled with its error intact) rather than retried
 * forever: at that point it is a bug to fix, not a blip to wait out, and leaving
 * it in the due set would starve healthy jobs behind it.
 */
export async function drainProjections(limit = DRAIN_BATCH): Promise<DrainReport> {
  const report: DrainReport = { claimed: 0, succeeded: 0, failed: 0, parked: 0 }
  const due = await prisma.noteProjectionJob.findMany({
    where: { doneAt: null, runAfter: { lte: new Date() } },
    orderBy: { runAfter: 'asc' },
    take: limit,
  })

  for (const job of due) {
    if (job.attempts >= MAX_ATTEMPTS) {
      const { count } = await prisma.noteProjectionJob.updateMany({
        where: { id: job.id, doneAt: null },
        data: { doneAt: new Date() },
      })
      if (count > 0) {
        report.parked += 1
        logger.error('notes.projection.parked', {
          jobId: job.id,
          spaceId: job.spaceId,
          path: job.path,
          attempts: job.attempts,
          err: job.lastError,
        })
      }
      continue
    }

    // Compare-and-swap the claim: whoever bumps `attempts` first owns this run.
    const { count } = await prisma.noteProjectionJob.updateMany({
      where: { id: job.id, attempts: job.attempts, doneAt: null },
      data: {
        attempts: job.attempts + 1,
        runAfter: new Date(Date.now() + backoffMs(job.attempts + 1)),
      },
    })
    if (count === 0) continue // another instance took it
    report.claimed += 1

    const input: ProjectionInput = {
      context: { spaceId: job.spaceId, ownerKey: job.ownerKey },
      path: job.path,
      kind: job.kind as ProjectionKind,
      fromPath: job.fromPath ?? undefined,
      origin: job.origin as NoteRevisionOrigin,
      actor: { id: job.actorId, name: job.actorName, email: job.actorEmail },
      model: job.model ?? undefined,
      changed: job.changed,
    }

    try {
      await applyProjections(input)
      await prisma.noteProjectionJob.deleteMany({ where: { id: job.id } })
      report.succeeded += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      report.failed += 1
      logger.error('notes.projection.retryFailed', {
        jobId: job.id,
        spaceId: job.spaceId,
        path: job.path,
        attempts: job.attempts + 1,
        err: message,
      })
      await prisma.noteProjectionJob
        .updateMany({ where: { id: job.id }, data: { lastError: message.slice(0, 1000) } })
        .catch(() => {})
    }
  }

  return report
}

export interface ReconcileReport {
  notes: number
  failed: number
  errors: { path: string; error: string }[]
}

/**
 * The RECONCILER: replay tier 1 over one context and rebuild every projection it
 * implies, whether or not anything said they were owed.
 *
 * This is what makes "a projection is rebuildable" an operation rather than an
 * assertion. Use it after restoring a backup, after a migration that changed how
 * a projection is derived, or when a subsystem's derived state is suspected of
 * having drifted — and note that it is the only path that can repair damage done
 * BEFORE the outbox existed, since no job row was ever written for those writes.
 *
 * Sequential on purpose: the hooks it drives write shared rows (link edges,
 * folder indexes), and a parallel sweep would race them against each other for
 * no wall-clock gain worth the risk.
 */
export async function reconcileContext(
  context: Context,
  actor: Actor = { id: 'system', name: 'Reconciler', email: null },
): Promise<ReconcileReport> {
  const report: ReconcileReport = { notes: 0, failed: 0, errors: [] }
  const rows = await prisma.contextNote.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: null },
    select: { path: true },
    orderBy: { path: 'asc' },
  })

  for (const row of rows) {
    try {
      await applyProjections({
        context,
        path: row.path,
        kind: 'write',
        // 'maintenance' keeps a reconcile out of the agent hook's "a human edited
        // my brief" path: rebuilding state must never deactivate a live agent.
        origin: 'maintenance',
        actor,
        changed: false,
      })
      report.notes += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      report.failed += 1
      report.errors.push({ path: row.path, error: message })
      logger.error('notes.reconcile.failed', { spaceId: context.spaceId, path: row.path, err: message })
    }
  }

  return report
}

/** Unsettled jobs, for the health surface: how far behind is the rebuild? */
export async function projectionBacklog(): Promise<{ pending: number; failing: number; oldestMs: number | null }> {
  const [pending, failing, oldest] = await Promise.all([
    prisma.noteProjectionJob.count({ where: { doneAt: null } }),
    prisma.noteProjectionJob.count({ where: { doneAt: null, attempts: { gt: 0 } } }),
    prisma.noteProjectionJob.findFirst({
      where: { doneAt: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ])
  return {
    pending,
    failing,
    oldestMs: oldest ? Date.now() - oldest.createdAt.getTime() : null,
  }
}
