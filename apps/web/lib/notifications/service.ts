/**
 * Notifications — the DB side (docs/notifications.md).
 *
 * `notify()` is the one writer: it inserts a row per recipient (dropping
 * repeats of an unread `dedupeKey`), pushes the new lines down the per-user
 * SSE stream so an open tab's bell updates at once. It NEVER
 * throws: a notification is a courtesy on top of whatever just happened, and
 * the thing that happened must not fail because the courtesy did.
 *
 * Callers anywhere in lib/ (connections.ts#markBroken, agents/hooks.ts,
 * agents/runner.ts, tools/registry.ts, notes/accessRequests.ts):
 *
 *   import { notify } from '@/lib/notifications/service'
 *   void notify(userIds, { spaceId, kind: 'connection_broken', title, body, href, dedupeKey })
 *
 * The rest — list / markRead / unreadCount — is what the routes and the bell need.
 */
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { agentNameOfHref } from '@/lib/agents/config'
import { publishToUsers } from '@/lib/messages/realtime'
import {
  LIST_MAX_TAKE,
  normalizeNotifyInput,
  scopeFilter,
  uniqueUserIds,
  type NotificationDTO,
  type NotificationScope,
  type NotifyInput,
} from './types'

export type { NotificationDTO, NotifyInput } from './types'

type Row = {
  id: string
  userId: string
  spaceId: string | null
  kind: string
  title: string
  body: string | null
  href: string | null
  createdAt: Date
  readAt: Date | null
}

function toDTO(r: Row): NotificationDTO {
  return {
    id: r.id,
    spaceId: r.spaceId,
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: r.href,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
  }
}

/**
 * Tell `userIds` something. Resolves to how many rows were actually created
 * (dedupe can make it fewer than the recipients). Never rejects.
 */
export async function notify(userIds: string[], n: NotifyInput): Promise<{ created: number }> {
  const input = normalizeNotifyInput(n)
  let rows: Row[] = []
  try {
    // Only people who still exist: a caller may hand us an author id whose
    // account is gone, and one bad FK would sink the whole batch.
    const wanted = uniqueUserIds(userIds)
    if (wanted.length === 0) return { created: 0 }
    const existing = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true } })
    const recipients = wanted.filter((id) => existing.some((u) => u.id === id))
    if (recipients.length === 0) return { created: 0 }
    // One INSERT for every recipient. The partial unique index
    // (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND read_at IS NULL is
    // what "ON CONFLICT … DO NOTHING" hits, so a repeat of an unread key is
    // silently dropped rather than failing the whole batch.
    const insert = (spaceId: string | null) => {
      const values = recipients.map(
        (userId) =>
          Prisma.sql`(${userId}, ${spaceId}, ${input.kind}, ${input.title}, ${input.body}, ${input.href}, ${input.dedupeKey})`,
      )
      return prisma.$queryRaw<Row[]>`
        INSERT INTO "notifications" ("user_id", "space_id", "kind", "title", "body", "href", "dedupe_key")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL AND "read_at" IS NULL DO NOTHING
        RETURNING "id", "user_id" AS "userId", "space_id" AS "spaceId", "kind", "title", "body", "href",
                  "created_at" AS "createdAt", "read_at" AS "readAt"
      `
    }
    try {
      rows = await insert(input.spaceId)
    } catch (err) {
      // A stale space id (the space was deleted between the event and this
      // write) is a foreign-key failure on the whole batch. The line is still
      // worth telling — retry once with no space rather than lose every
      // recipient's copy over a label.
      if (input.spaceId !== null && isForeignKeyFailure(err)) {
        logger.warn('notifications.insert.stale_space', { spaceId: input.spaceId, kind: input.kind })
        rows = await insert(null)
      } else {
        throw err
      }
    }
  } catch (err) {
    logger.error('notifications.insert.failed', { err, kind: input.kind })
    return { created: 0 }
  }
  if (rows.length === 0) return { created: 0 }

  // Realtime: each recipient only gets their own line.
  for (const row of rows) {
    try {
      publishToUsers([row.userId], { type: 'notification.new', notification: toDTO(row) })
    } catch (err) {
      logger.error('notifications.publish.failed', { err })
    }
  }

  return { created: rows.length }
}

/**
 * Prisma's P2003 (a raw query surfaces it as the pg SQLSTATE 23503 in `meta`
 * or the message) — a foreign key the row pointed at is gone.
 */
export function isForeignKeyFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown }
  if (e.code === 'P2003' || e.code === '23503') return true
  if (e.meta && typeof e.meta === 'object' && e.meta.code === '23503') return true
  return typeof e.message === 'string' && /23503|foreign key constraint/i.test(e.message)
}

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; take?: number; scope?: NotificationScope; spaceId?: string | null } = {},
): Promise<NotificationDTO[]> {
  const take = Math.min(Math.max(1, opts.take ?? 30), LIST_MAX_TAKE)
  const scoped = scopeFilter(opts.scope ?? 'all', opts.spaceId ?? null)
  // `null` is "no row can match" — asked for a space's lines while standing in
  // no space. Answering with everything would be the opposite of the filter.
  if (scoped === null) return []
  const rows = await prisma.notification.findMany({
    where: { userId, ...scoped, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
  })
  return rows.map(toDTO)
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } })
}

/**
 * The three numbers the bell's tabs need in one round-trip: everything unread,
 * the person's own (space-less) lines, and this space's. `space` is 0 when the
 * caller isn't in a space rather than a repeat of the total.
 */
export async function unreadCounts(
  userId: string,
  spaceId: string | null,
): Promise<{ total: number; global: number; space: number }> {
  const [total, global, space] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.count({ where: { userId, readAt: null, spaceId: null } }),
    spaceId ? prisma.notification.count({ where: { userId, readAt: null, spaceId } }) : Promise.resolve(0),
  ])
  return { total, global, space }
}

/**
 * Mark the given ids (only the caller's own rows) or everything unread as read.
 * With `all`, an optional scope limits it to the half the person is looking at:
 * "Mark all read" on the space tab must not silently clear the global one.
 */
export async function markRead(
  userId: string,
  target: { ids?: string[]; all?: boolean; scope?: NotificationScope; spaceId?: string | null },
): Promise<{ updated: number }> {
  const scoped = target.all ? scopeFilter(target.scope ?? 'all', target.spaceId ?? null) : {}
  if (scoped === null) return { updated: 0 }
  const where = target.all
    ? { userId, readAt: null, ...scoped }
    : { userId, readAt: null, id: { in: (target.ids ?? []).filter((id) => typeof id === 'string').slice(0, 500) } }
  if (!target.all && (where as { id: { in: string[] } }).id.in.length === 0) return { updated: 0 }
  const res = await prisma.notification.updateMany({ where, data: { readAt: new Date() } })
  return { updated: res.count }
}

const REPLY_MAX_CHARS = 2_000

export type ReplyResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string }

/**
 * Answer an `agent_question` line: the reply becomes a `reply` event for the
 * agent that asked (lib/agents/events.ts), so it arrives as the payload of
 * that agent's next run, and the line is marked read. Which agent asked is
 * read back from the row's href (`/directory/agent:<name>`), which is how
 * ask_human wrote it — no extra column. Only the row's owner can answer it,
 * only while they are still an active member of the space the agent runs in
 * (a question outlives a membership; the answer must not), and only ONCE: a
 * read row is an answered — or dismissed — question, so a replayed POST is a
 * 409 rather than a second event for the agent.
 */
export async function replyToQuestion(userId: string, notificationId: string, text: string): Promise<ReplyResult> {
  const reply = text.trim()
  if (!reply) return { ok: false, status: 400, error: 'Reply is empty' }
  if (reply.length > REPLY_MAX_CHARS) return { ok: false, status: 400, error: `Reply is longer than ${REPLY_MAX_CHARS} characters` }
  const row = await prisma.notification.findFirst({ where: { id: notificationId, userId } })
  if (!row) return { ok: false, status: 404, error: 'No such notification' }
  if (row.kind !== 'agent_question') return { ok: false, status: 400, error: 'This notification is not a question' }
  if (row.readAt) return { ok: false, status: 409, error: 'This question has already been answered' }
  const agentName = agentNameOfHref(row.href)
  if (!row.spaceId || !agentName) return { ok: false, status: 400, error: 'This question no longer names an agent' }
  const member = await prisma.spaceMember.findFirst({
    where: { userId, spaceId: row.spaceId, status: 'active' },
    select: { id: true },
  })
  if (!member) return { ok: false, status: 403, error: 'You are no longer a member of the space this agent runs in' }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  const who = user?.name?.trim() || 'Someone'
  const question = row.body ?? row.title
  const { enqueueAgentEvent } = await import('@/lib/agents/events')
  const result = await enqueueAgentEvent({
    spaceId: row.spaceId,
    agentName,
    kind: 'reply',
    source: `reply:${userId}`,
    summary: `${who} replied to "${question.length > 80 ? question.slice(0, 80) + '…' : question}"`,
    payload: { question, reply, by: { id: userId, name: who }, notificationId: row.id },
  })
  if (!result.ok && 'capped' in result) return { ok: false, status: 409, error: 'The agent has too many pending events; try again later' }
  await markRead(userId, { ids: [row.id] })
  return { ok: true }
}
