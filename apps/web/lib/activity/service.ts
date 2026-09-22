/**
 * Everything about a person, across every space they are in (docs/mobile.md).
 *
 * Six sources, each read once for the caller's spaces and cut at the cursor,
 * then folded by `shared/fold.ts`. There is no activity table: the rows are
 * views of what already happened — a run that acted for them, a mention or a
 * reply, a request they can answer as an admin, an event they are going to.
 * Nothing here writes; the request rows carry the existing doors.
 */
import prisma from '@/lib/prisma'
import { adminSpaceIdsFrom } from '@/lib/auth'
import type { SessionPayload } from '@/lib/session'
import { findOwnAgentBrief } from '@/lib/agents/briefs'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import {
  ACTIVITY_WINDOW_DAYS,
  decodeActivityCursor,
  foldActivity,
  upcomingOf,
  type ActivityCursor,
} from './shared/fold'
import {
  rowForAccessRequest,
  rowForEvent,
  rowForJoinRequest,
  rowForMention,
  rowForReply,
  rowForRun,
  type ActivityRow,
} from './shared/rows'

export interface ActivityPage {
  /** The caller's next events — first page only. */
  upcoming: ActivityRow[]
  items: ActivityRow[]
  nextCursor: string | null
}

const SOURCE_TAKE = 60

type Person = { id: string; name: string | null; email: string | null; image: string | null }
const person = (u: Person) => ({ id: u.id, name: u.name ?? u.email ?? 'Someone', image: u.image })

async function agentTitles(pairs: { spaceId: string; name: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const seen = new Set<string>()
  for (const { spaceId, name } of pairs) {
    const key = `${spaceId}:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    const row = await findOwnAgentBrief(spaceId, name)
    const title = row ? parseFrontmatter(row.content).title : null
    out.set(key, typeof title === 'string' && title.trim() ? title.trim() : name)
  }
  return out
}

export async function listActivityForUser(
  session: SessionPayload,
  opts: { cursor?: string | null; limit?: number; now?: Date } = {},
): Promise<ActivityPage> {
  const now = opts.now ?? new Date()
  const cursor: ActivityCursor | null = decodeActivityCursor(opts.cursor)
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000)
  const before = cursor ? new Date(Math.min(cursor.at.getTime(), now.getTime())) : now
  const me = session.userId

  const memberships = await prisma.spaceMember.findMany({
    where: { userId: me, status: 'active', space: { personalOwnerId: null } },
    select: { space: { select: { id: true, name: true, aliases: true, parentId: true, parentAdmins: true } } },
  })
  const spaces = memberships.map((m) => m.space)
  if (spaces.length === 0) return { upcoming: [], items: [], nextCursor: null }
  const spaceName = new Map(spaces.map((s) => [s.id, s.name]))
  const mine = spaces.map((s) => s.id)
  const admin = [...(await adminSpaceIdsFrom(me, spaces, session.email))]

  const [runs, mentions, replies, joins, accesses, attendee] = await Promise.all([
    prisma.agentRun.findMany({
      where: { spaceId: { in: mine }, status: { not: 'running' }, OR: [{ runAsUserId: me }, { startedBy: me }], endedAt: { gte: since, lt: before } },
      orderBy: { endedAt: 'desc' },
      take: SOURCE_TAKE,
      select: { id: true, spaceId: true, name: true, status: true, endedAt: true, summary: true, errorMessage: true },
    }),
    prisma.messageMention.findMany({
      where: { mentionedUserId: me, createdAt: { gte: since, lt: before }, message: { deletedAt: null, senderId: { not: me } } },
      orderBy: { createdAt: 'desc' },
      take: SOURCE_TAKE,
      select: {
        id: true,
        createdAt: true,
        message: {
          select: {
            id: true,
            text: true,
            createdAt: true,
            sender: { select: { id: true, name: true, email: true, image: true } },
            conversation: { select: { id: true, name: true, type: true, spaceId: true, space: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.message.findMany({
      where: { deletedAt: null, senderId: { not: me }, createdAt: { gte: since, lt: before }, replyTo: { senderId: me } },
      orderBy: { createdAt: 'desc' },
      take: SOURCE_TAKE,
      select: {
        id: true,
        text: true,
        createdAt: true,
        sender: { select: { id: true, name: true, email: true, image: true } },
        conversation: { select: { id: true, name: true, type: true, spaceId: true, space: { select: { name: true } } } },
      },
    }),
    admin.length
      ? prisma.spaceMember.findMany({
          where: { spaceId: { in: admin }, status: 'pending', joinedAt: { lt: before } },
          orderBy: { joinedAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, spaceId: true, joinedAt: true, user: { select: { id: true, name: true, email: true, image: true } } },
        })
      : Promise.resolve([]),
    admin.length
      ? prisma.contextAccessRequest.findMany({
          where: { spaceId: { in: admin }, status: 'pending', userId: { not: me }, createdAt: { lt: before } },
          orderBy: { createdAt: 'desc' },
          take: SOURCE_TAKE,
          select: { id: true, spaceId: true, resourcePath: true, level: true, message: true, createdAt: true, user: { select: { id: true, name: true, email: true, image: true } } },
        })
      : Promise.resolve([]),
    cursor
      ? Promise.resolve([])
      : prisma.eventAttendee.findMany({
          where: {
            status: { in: ['going', 'waitlisted', 'pending', 'checked_in', 'invited'] },
            OR: [
              ...(session.email ? [{ email: { equals: session.email, mode: 'insensitive' as const } }] : []),
              { personId: { in: (await prisma.node.findMany({ where: { spaceId: { in: mine }, identity: { userId: me } }, select: { id: true } })).map((n) => n.id) } },
            ],
          },
          select: { eventId: true, status: true },
          take: 200,
        }),
  ])

  const titles = await agentTitles(runs.map((r) => ({ spaceId: r.spaceId, name: r.name })))
  const runRows = runs
    .filter((r) => r.endedAt)
    .map((r) =>
      rowForRun({
        id: r.id,
        spaceId: r.spaceId,
        spaceName: spaceName.get(r.spaceId) ?? r.spaceId,
        agentName: r.name,
        agentTitle: titles.get(`${r.spaceId}:${r.name}`) ?? r.name,
        status: r.status,
        endedAt: r.endedAt!,
        summary: r.summary,
        errorMessage: r.errorMessage,
      }),
    )

  const convoName = (c: { name: string | null; type: string }) => (c.type === 'DM' ? null : c.name)
  const mentionRows = mentions.map((m) =>
    rowForMention({
      mentionId: m.id,
      messageId: m.message.id,
      conversationId: m.message.conversation.id,
      conversationName: convoName(m.message.conversation),
      spaceId: m.message.conversation.spaceId,
      spaceName: m.message.conversation.space?.name ?? null,
      createdAt: m.createdAt,
      text: m.message.text,
      sender: person(m.message.sender),
    }),
  )
  const replyRows = replies.map((r) =>
    rowForReply({
      messageId: r.id,
      conversationId: r.conversation.id,
      conversationName: convoName(r.conversation),
      spaceId: r.conversation.spaceId,
      spaceName: r.conversation.space?.name ?? null,
      createdAt: r.createdAt,
      text: r.text,
      sender: person(r.sender),
    }),
  )
  const joinRows = joins.map((j) =>
    rowForJoinRequest({ membershipId: j.id, spaceId: j.spaceId, spaceName: spaceName.get(j.spaceId) ?? j.spaceId, joinedAt: j.joinedAt, user: person(j.user) }),
  )
  const accessRows = accesses.map((a) =>
    rowForAccessRequest({
      requestId: a.id,
      spaceId: a.spaceId,
      spaceName: spaceName.get(a.spaceId) ?? a.spaceId,
      resourcePath: a.resourcePath,
      level: a.level,
      message: a.message,
      createdAt: a.createdAt,
      user: person(a.user),
    }),
  )

  let upcoming: ActivityRow[] = []
  if (attendee.length) {
    const statusOf = new Map(attendee.map((a) => [a.eventId, a.status]))
    const events = await prisma.node.findMany({
      where: { id: { in: [...statusOf.keys()] }, type: 'event', spaceId: { in: mine } },
      select: { id: true, spaceId: true, name: true, metadata: true },
    })
    upcoming = upcomingOf(
      events.map((e) => {
        const meta = (e.metadata ?? {}) as Record<string, unknown>
        const loc = meta.locationData as { name?: string; address?: string } | undefined
        return rowForEvent({
          eventId: e.id,
          spaceId: e.spaceId!,
          spaceName: spaceName.get(e.spaceId!) ?? e.spaceId!,
          title: e.name,
          startAt: typeof meta.start_at === 'string' ? meta.start_at : '',
          location: loc?.name ?? loc?.address ?? null,
          status: statusOf.get(e.id) ?? 'going',
        })
      }).filter((r) => r.at),
      now,
    )
  }

  const folded = foldActivity([runRows, mentionRows, replyRows, joinRows, accessRows], { cursor, limit: opts.limit })
  return { upcoming, items: folded.items, nextCursor: folded.nextCursor }
}
