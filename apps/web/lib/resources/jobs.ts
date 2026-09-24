/**
 * The work a resource still owes — its renditions, its text, its unfurl — as
 * rows, because the runtime scales to zero and throttles CPU the moment a
 * response is sent: work "after" a request is work that may never happen.
 * So every job runs INSIDE a request, from one of three drains:
 *
 * 1. inline, with a budget, where a request is already paying (the upload's
 *    `complete`; a message send);
 * 2. pulled — a client drawing a pending thumb or card asks
 *    `POST /api/resources/jobs/pull`, and whoever is looking finishes it;
 * 3. the minute tick, as the backstop for everything nobody looked at.
 *
 * A job is claimed with a conditional UPDATE (`FOR UPDATE SKIP LOCKED`), so N
 * instances racing run it once; a claim holds a two-minute lease, so a claimer
 * that dies is retried. Failures back off and give up after the last step.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'

export type JobKind = 'rendition' | 'extract' | 'unfurl' | 'refresh' | 'scan'

interface ClaimedJob {
  id: string
  resource_id: string
  kind: JobKind
  attempts: number
}

/** Retry delays after each failed attempt; past the last, the job is failed. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 3 * 60 * 60_000]

const LEASE_SECONDS = 120

type Runner = (resourceId: string) => Promise<void>

/**
 * What each kind does. Registered by the module that owns the work, so this
 * file imports none of it (renditions pull in sharp and pdf.js, the unfurler
 * the network) and a drain loads only what its jobs need.
 */
const RUNNERS: Partial<Record<JobKind, () => Promise<Runner>>> = {
  rendition: async () => (await import('./renditions')).renderResource,
  extract: async () => async (id) => {
    await (await import('./service')).indexResource(id)
  },
  unfurl: async () => (await import('./unfurl')).unfurlResource,
  refresh: async () => (await import('./unfurl')).unfurlResource,
}

/** Queue work for a resource; a kind already queued or done is queued again. */
export async function enqueueJobs(resourceId: string, kinds: JobKind[], runAfter = new Date()): Promise<void> {
  for (const kind of new Set(kinds)) {
    await prisma.resourceJob.upsert({
      where: { resourceId_kind: { resourceId, kind } },
      create: { resourceId, kind, runAfter },
      update: { state: 'queued', attempts: 0, error: null, runAfter, lockedUntil: null },
    })
  }
}

async function claim(limit: number, resourceIds?: string[]): Promise<ClaimedJob[]> {
  if (resourceIds && resourceIds.length === 0) return []
  // The claimable rows are picked with SKIP LOCKED, and the UPDATE says again
  // what claimable means: under a concurrent claim Postgres re-evaluates that
  // condition against the committed row, so a job another drain has just
  // taken is never taken twice.
  //
  // `run_after` is written from the app's clock (enqueue, backoff), so it is
  // compared against the app's clock too: against the database's, a job
  // queued a moment ago reads as not yet due whenever that clock runs a few
  // milliseconds behind, and a drain right after the enqueue finds nothing.
  // The lease is the database's on both sides.
  const scope = resourceIds ?? null
  const due = new Date()
  return prisma.$queryRaw<ClaimedJob[]>`
    WITH picked AS (
      SELECT id FROM resource_jobs
      WHERE (state = 'queued' OR (state = 'running' AND locked_until < now()))
        AND run_after <= ${due}
        AND (${scope}::text[] IS NULL OR resource_id = ANY(${scope}::text[]))
      ORDER BY run_after
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE resource_jobs j
    SET state = 'running', attempts = j.attempts + 1,
        locked_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
    FROM picked
    WHERE j.id = picked.id
      AND (j.state = 'queued' OR (j.state = 'running' AND j.locked_until < now()))
    RETURNING j.id, j.resource_id, j.kind, j.attempts`
}

async function settle(job: ClaimedJob, error: unknown): Promise<void> {
  if (!error) {
    await prisma.resourceJob.update({ where: { id: job.id }, data: { state: 'done', lockedUntil: null, error: null } })
    return
  }
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
  const delay = BACKOFF_MS[job.attempts - 1]
  await prisma.resourceJob.update({
    where: { id: job.id },
    data: delay
      ? { state: 'queued', lockedUntil: null, error: message, runAfter: new Date(Date.now() + delay) }
      : { state: 'failed', lockedUntil: null, error: message },
  })
  logger.warn('resources.job.failed', { jobId: job.id, kind: job.kind, attempts: job.attempts, error: message })
}

async function runOne(job: ClaimedJob): Promise<void> {
  const load = RUNNERS[job.kind]
  if (!load) {
    await settle(job, null)
    return
  }
  let failure: unknown = null
  try {
    await (await load())(job.resource_id)
  } catch (err) {
    failure = err ?? new Error('failed')
  }
  await settle(job, failure)
}

export interface DrainReport {
  ran: number
  pending: number
}

/**
 * Run due jobs until the budget is spent — only `resourceIds`' when given (a
 * pull), else anyone's (the tick). A job that starts before the budget ends
 * is allowed to finish: a half-drawn rendition helps nobody.
 */
export async function drainJobs({
  budgetMs,
  resourceIds,
  batch = 4,
}: {
  budgetMs: number
  resourceIds?: string[]
  batch?: number
}): Promise<DrainReport> {
  const deadline = Date.now() + budgetMs
  let ran = 0
  while (Date.now() < deadline) {
    const jobs = await claim(batch, resourceIds)
    if (jobs.length === 0) break
    for (const job of jobs) {
      await runOne(job)
      ran++
    }
  }
  const pending = await prisma.resourceJob.count({
    where: { state: { in: ['queued', 'running'] }, ...(resourceIds ? { resourceId: { in: resourceIds } } : {}) },
  })
  return { ran, pending }
}

/** What a client waiting on a resource needs to know: is anything still owed? */
export async function pendingJobKinds(resourceIds: string[]): Promise<Map<string, JobKind[]>> {
  const rows = await prisma.resourceJob.findMany({
    where: { resourceId: { in: resourceIds }, state: { in: ['queued', 'running'] } },
    select: { resourceId: true, kind: true },
  })
  const out = new Map<string, JobKind[]>()
  for (const row of rows) out.set(row.resourceId, [...(out.get(row.resourceId) ?? []), row.kind as JobKind])
  return out
}
