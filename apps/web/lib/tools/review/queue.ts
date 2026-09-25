/**
 * Visvine's global stages as queued work. Co-signing a listing enqueues one
 * review run; the minute tick drains the queue (lib/tools/review/run.ts), and
 * a reviewer may run one again. Claiming is a conditional UPDATE, so N
 * instances racing run each review once.
 */
import prisma from '@/lib/prisma'

/** A run nobody finished in this long is taken back and tried again. */
const STALE_RUN_MS = 10 * 60_000
/** Tries before a review gives up and says so. */
export const MAX_REVIEW_ATTEMPTS = 3

/** Queue a review of one version, unless one is already waiting. */
export async function enqueueReview(versionId: string): Promise<string> {
  const waiting = await prisma.appToolReviewRun.findFirst({
    where: { versionId, status: { in: ['queued', 'running'] } },
    select: { id: true },
  })
  if (waiting) return waiting.id
  const row = await prisma.appToolReviewRun.create({ data: { versionId }, select: { id: true } })
  return row.id
}

/** Claim the oldest queued run (or one abandoned mid-run), or null when there is none. */
export async function claimReview(now: Date = new Date()): Promise<{ id: string; versionId: string; attempts: number } | null> {
  const stale = new Date(now.getTime() - STALE_RUN_MS)
  const candidates = await prisma.appToolReviewRun.findMany({
    where: {
      OR: [{ status: 'queued' }, { status: 'running', startedAt: { lt: stale } }],
      attempts: { lt: MAX_REVIEW_ATTEMPTS },
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
    select: { id: true, versionId: true, attempts: true, status: true, startedAt: true },
  })
  for (const candidate of candidates) {
    const claimed = await prisma.appToolReviewRun.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        ...(candidate.startedAt ? { startedAt: candidate.startedAt } : { startedAt: null }),
      },
      data: { status: 'running', startedAt: now, attempts: { increment: 1 } },
    })
    if (claimed.count === 1) return { id: candidate.id, versionId: candidate.versionId, attempts: candidate.attempts + 1 }
  }
  return null
}
