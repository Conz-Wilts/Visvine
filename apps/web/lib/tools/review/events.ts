/**
 * The dynamic run's evidence log (`app_tool_review_events`): what the Tool
 * did while it ran — every bridge call, every door it asked for, every CSP
 * report, navigation and egress attempt. Written by the bridge, the CSP
 * report sink and the runner; read once, by the scan, when the run ends.
 *
 * Counts and shapes, never whole payloads: a detail is clipped, because what
 * the scan needs is whether a planted token went somewhere, and a token is
 * short.
 */
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'

export type ReviewEventKind = 'bridge' | 'door' | 'csp' | 'navigation' | 'egress' | 'console'

/** How much of one event's detail is kept. */
const DETAIL_CHARS = 8_000
/** Events one run may write; a Tool in a loop stops being recorded, not the run. */
const MAX_EVENTS_PER_RUN = 2_000

function clipped(detail: Record<string, unknown>): Prisma.InputJsonValue {
  const text = JSON.stringify(detail) ?? '{}'
  if (text.length <= DETAIL_CHARS) return detail as Prisma.InputJsonValue
  return { clipped: text.slice(0, DETAIL_CHARS) }
}

export async function recordReviewEvent(
  runId: string,
  kind: ReviewEventKind,
  method: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    // A run is seconds long and its bridge calls are rate limited, so a count
    // per write is cheap — and it holds across instances, where a map would not.
    if ((await prisma.appToolReviewEvent.count({ where: { runId } })) >= MAX_EVENTS_PER_RUN) return
    await prisma.appToolReviewEvent.create({ data: { runId, kind, method, detail: clipped(detail) } })
  } catch (err) {
    // The run may have ended and taken its rows with it; nothing to keep.
    logger.warn('tools.review.event_failed', { err, runId, kind })
  }
}

export async function reviewEvents(runId: string) {
  return prisma.appToolReviewEvent.findMany({
    where: { runId },
    orderBy: { at: 'asc' },
    select: { kind: true, method: true, detail: true, at: true },
  })
}
